// @flow

import {put, call} from 'redux-saga/effects';
import {
  Device,
  Service,
  Characteristic,
  Descriptor,
  BleError,
  BleErrorCode,
} from 'react-native-ble-plx';
import {log, logError} from './Reducer';

export type SensorTagTestMetadata = {
  id: string,
  title: string,
  execute: (device: Device) => Generator<any, boolean, any>,
};

export const SensorTagTests: {[string]: SensorTagTestMetadata} = {
  READ_ALL_CHARACTERISTICS: {
    id: 'READ_ALL_CHARACTERISTICS',
    title: 'Read all characteristics',
    execute: readAllCharacteristics,
  },
  READ_TEMPERATURE: {
    id: 'READ_TEMPERATURE',
    title: 'Read temperature',
    execute: readTemperature,
  },
};

function* readAllCharacteristics(device: Device): Generator<*, boolean, *> {
  try {
    const rssiDevice: Device = yield call([device, device.readRSSI]);
    yield put(log(`Read RSSI: ${rssiDevice.rssi}`));
    const services: Array<Service> = yield call([device, device.services]);
    for (const service of services) {
      yield put(log('Found service: ' + service.uuid));
      const characteristics: Array<Characteristic> = yield call([
        service,
        service.characteristics,
      ]);
      for (const characteristic of characteristics) {
        yield put(log('Found characteristic: ' + characteristic.uuid));

        if (characteristic.uuid === '00002a02-0000-1000-8000-00805f9b34fb')
          continue;

        const descriptors: Array<Descriptor> = yield call([
          characteristic,
          characteristic.descriptors,
        ]);

        for (const descriptor of descriptors) {
          yield put(log('* Found descriptor: ' + descriptor.uuid));
          yield put(log('Reading descriptor...'));
          const readDescriptor: Descriptor = yield call([
            descriptor,
            descriptor.read,
          ]);
          yield put(
            log('Descriptor value: ' + (readDescriptor.value || 'null')),
          );
          if (readDescriptor.uuid === '00002902-0000-1000-8000-00805f9b34fb') {
            yield put(log('Skipping CCC'));
            continue;
          }
          try {
            yield put(log('Writing to descriptor...'));
            yield call([descriptor, descriptor.write], readDescriptor.value);
            yield put(log('Descriptor write successful'));
          } catch (error) {
            const bleError: BleError = error;
            if (bleError.errorCode === BleErrorCode.DescriptorWriteFailed) {
              yield put(log('Cannot write to: ' + descriptor.uuid));
            } else {
              throw error;
            }
          }
        }

        yield put(log('Found characteristic: ' + characteristic.uuid));
        if (characteristic.isReadable) {
          yield put(log('Reading value...'));
          let readCharacteristic = yield call([
            characteristic,
            characteristic.read,
          ]);
          yield put(log('Got base64 value: ' + readCharacteristic.value));
          if (characteristic.isWritableWithResponse) {
            yield call(
              [characteristic, characteristic.writeWithResponse],
              readCharacteristic.value,
            );
            yield put(log('Successfully written value back'));
          }
        }
      }
    }
  } catch (error) {
    yield put(logError(error));
    return false;
  }

  return true;
}

function* readTemperature(device: Device): Generator<*, boolean, *> {
  yield put(log('Read temperature'));
  return false;
}
