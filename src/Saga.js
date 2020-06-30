// @flow

import {PermissionsAndroid, Platform} from 'react-native';
import {buffers, eventChannel} from 'redux-saga';
import {
  fork,
  cancel,
  take,
  call,
  put,
  race,
  cancelled,
  actionChannel,
} from 'redux-saga/effects';
import {
  log,
  logError,
  updateConnectionState,
  bleStateUpdated,
  testFinished,
  type BleStateUpdatedAction,
  type UpdateConnectionStateAction,
  type ConnectAction,
  type ExecuteTestAction,
  sensorTagFound,
  ConnectionState,
} from './Reducer';
import {
  BleManager,
  BleError,
  Device,
  State,
  LogLevel,
} from 'react-native-ble-plx';
import {SensorTagTests} from './Tests';

import {blemulator, SimulatedPeripheral} from 'react-native-blemulator';
import { AdapterState } from 'react-native-blemulator/src/types';

const peripheral1: SimulatedPeripheral = new SimulatedPeripheral({
  name: 'SensorTag',
  id: 'test id 1',
  advertisementInterval: 500,
  localName: 'SensorTag',
  services: [],
});

const peripheral2: SimulatedPeripheral = new SimulatedPeripheral({
  name: 'SensorTag',
  id: 'test id 2',
  advertisementInterval: 600,
  localName: 'SensorTag',
  services: [],
});

function setupPeripheral() {
  blemulator.addPeripheral(peripheral1);
  blemulator.addPeripheral(peripheral2);
}

export function* bleSaga(): Generator<*, *, *> {
  yield put(log('BLE saga started...'));

  // Turn on BLEmulator
  setupPeripheral();
  yield call([blemulator, blemulator.simulate]);

  // First step is to create BleManager which should be used as an entry point
  // to all BLE related functionalities
  const manager = new BleManager();
  manager.setLogLevel(LogLevel.Verbose);

  // All below generators are described below...
  yield fork(handleScanning, manager);
  yield fork(handleBleState, manager);
  yield fork(handleConnection, manager);
  yield fork(toggleRadio, manager);

  yield fork(handleBlemulatorActions);
}

// This generator tracks our BLE state. Based on that we can enable scanning, get rid of devices etc.
// eventChannel allows us to wrap callback based API which can be then conveniently used in sagas.
function* handleBleState(manager: BleManager): Generator<*, *, *> {
  const stateChannel = yield eventChannel((emit) => {
    const subscription = manager.onStateChange((state) => {
      emit(state);
    }, true);
    return () => {
      subscription.remove();
    };
  }, buffers.expanding(1));

  try {
    for (;;) {
      const newState = yield take(stateChannel);
      yield put(bleStateUpdated(newState));
    }
  } finally {
    if (yield cancelled()) {
      stateChannel.close();
    }
  }
}

// This generator decides if we want to start or stop scanning depending on specific
// events:
// * BLE state is in PoweredOn state
// * Android's permissions for scanning are granted
// * We already scanned device which we wanted
function* handleScanning(manager: BleManager): Generator<*, *, *> {
  var scanTask = null;
  var bleState: $Keys<typeof State> = State.Unknown;
  var connectionState: $Keys<typeof ConnectionState> =
    ConnectionState.DISCONNECTED;

  const channel = yield actionChannel([
    'BLE_STATE_UPDATED',
    'UPDATE_CONNECTION_STATE',
  ]);

  for (;;) {
    const action:
      | BleStateUpdatedAction
      | UpdateConnectionStateAction = yield take(channel);

    switch (action.type) {
      case 'BLE_STATE_UPDATED':
        bleState = action.state;
        break;
      case 'UPDATE_CONNECTION_STATE':
        connectionState = action.state;
        break;
    }

    const enableScanning =
      bleState === State.PoweredOn &&
      (connectionState === ConnectionState.DISCONNECTING ||
        connectionState === ConnectionState.DISCONNECTED);

    if (enableScanning) {
      if (scanTask != null) {
        yield cancel(scanTask);
      }
      scanTask = yield fork(scan, manager);
    } else {
      if (scanTask != null) {
        yield cancel(scanTask);
        scanTask = null;
      }
    }
  }
}

// As long as this generator is working we have enabled scanning functionality.
// When we detect SensorTag device we make it as an active device.
function* scan(manager: BleManager): Generator<*, *, *> {
  if (Platform.OS === 'android' && Platform.Version >= 23) {
    yield put(log('Scanning: Checking permissions...'));
    const enabled = yield call(
      PermissionsAndroid.check,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    );
    if (!enabled) {
      yield put(log('Scanning: Permissions disabled, showing...'));
      const granted = yield call(
        PermissionsAndroid.request,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        yield put(log('Scanning: Permissions not granted, aborting...'));
        // TODO: Show error message?
        return;
      }
    }
  }

  yield put(log('Scanning started...'));
  const scanningChannel = yield eventChannel((emit) => {
    manager.startDeviceScan(
      null,
      {allowDuplicates: true},
      (error, scannedDevice) => {
        if (error) {
          emit([error, scannedDevice]);
          return;
        }
        if (scannedDevice != null && scannedDevice.localName === 'SensorTag') {
          emit([error, scannedDevice]);
        }
      },
    );
    return () => {
      manager.stopDeviceScan();
    };
  }, buffers.expanding(1));

  try {
    for (;;) {
      const [error, scannedDevice]: [?BleError, ?Device] = yield take(
        scanningChannel,
      );
      if (error != null) {
      }
      if (scannedDevice != null) {
        yield put(sensorTagFound(scannedDevice));
      }
    }
  } catch (error) {
  } finally {
    yield put(log('Scanning stopped...'));
    if (yield cancelled()) {
      scanningChannel.close();
    }
  }
}

function* handleConnection(manager: BleManager): Generator<*, *, *> {
  var testTask = null;

  for (;;) {
    // Take action
    const {device}: ConnectAction = yield take('CONNECT');

    const disconnectedChannel = yield eventChannel((emit) => {
      const subscription = device.onDisconnected((error) => {
        emit({type: 'DISCONNECTED', error: error});
      });
      return () => {
        subscription.remove();
      };
    }, buffers.expanding(1));

    const deviceActionChannel = yield actionChannel([
      'DISCONNECT',
      'EXECUTE_TEST',
    ]);

    try {
      yield put(updateConnectionState(ConnectionState.CONNECTING));
      yield call([device, device.connect]);
      yield put(updateConnectionState(ConnectionState.DISCOVERING));
    //   yield call([device, device.discoverAllServicesAndCharacteristics]); // TODO uncomment
      yield put(updateConnectionState(ConnectionState.CONNECTED));

      for (;;) {
        const {deviceAction, disconnected} = yield race({
          deviceAction: take(deviceActionChannel),
          disconnected: take(disconnectedChannel),
        });

        if (deviceAction) {
          if (deviceAction.type === 'DISCONNECT') {
            yield put(log('Disconnected by user...'));
            yield put(updateConnectionState(ConnectionState.DISCONNECTING));
            yield call([device, device.cancelConnection]);
            break;
          }
          if (deviceAction.type === 'EXECUTE_TEST') {
            if (testTask != null) {
              yield cancel(testTask);
            }
            testTask = yield fork(executeTest, device, deviceAction);
          }
        } else if (disconnected) {
          yield put(log('Disconnected by device...'));
          if (disconnected.error != null) {
            yield put(logError(disconnected.error));
          }
          break;
        }
      }
    } catch (error) {
      yield put(logError(error));
    } finally {
      disconnectedChannel.close();
      yield put(testFinished());
      yield put(updateConnectionState(ConnectionState.DISCONNECTED));
    }
  }
}

function* toggleRadio(manager: BleManager): Generator<*, *, *> {
  //Anroid only
  const toggleRadioActionChannel = yield actionChannel(['TOGGLE_RADIO']);
  for (;;) {
    const action = yield take(toggleRadioActionChannel);

    if (action.type === 'TOGGLE_RADIO') {
      const state = yield call([manager, manager.state]);
      if (state === State.PoweredOn) {
        yield call([manager, manager.disable]);
      } else {
        yield call([manager, manager.enable]);
      }
    }
  }
}

function* handleBlemulatorActions(): Generator<*, *, *> {
  const blemulatorActionChannel = yield actionChannel([
    'SIM_LOSE_CONNECTION',
    'SIM_TOGGLE_RADIO',
  ]);

  for (;;) {
    const action = yield take(blemulatorActionChannel);
    switch (action.type) {
      case 'SIM_LOSE_CONNECTION':
        if (peripheral1.isConnected()) {
          peripheral1.onDisconnect({emit: true});
        } else if (peripheral2.isConnected()) {
          peripheral2.onDisconnect({emit: true});
        }
        break;
      case 'SIM_TOGGLE_RADIO':
        if (blemulator.getSimulatedAdapterState() === AdapterState.POWERED_ON) {
          blemulator.setSimulatedAdapterState(AdapterState.POWERED_OFF);
        } else {
          blemulator.setSimulatedAdapterState(AdapterState.POWERED_ON);
        }
        break;
    }
  }
}

function* executeTest(
  device: Device,
  test: ExecuteTestAction,
): Generator<*, *, *> {
  yield put(log('Executing test: ' + test.id));
  const start = Date.now();
  const result = yield call(SensorTagTests[test.id].execute, device);
  if (result) {
    yield put(
      log('Test finished successfully! (' + (Date.now() - start) + ' ms)'),
    );
  } else {
    yield put(log('Test failed! (' + (Date.now() - start) + ' ms)'));
  }
  yield put(testFinished());
}
