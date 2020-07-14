// @flow

import {
  SimulatedPeripheral,
  SimulatedService,
  SimulatedCharacteristic,
  SimulatedDescriptor,
} from 'react-native-blemulator';

export const TEMPERATURE_SERVICE_UUID = 'F000AA00-0451-4000-B000-000000000000';
export const TEMPERATURE_DATA_CHARACTERISTIC_UUID = 'F000AA01-0451-4000-B000-000000000000';
export const TEMPERATURE_CONFIG_CHARACTERISTIC_UUID = 'F000AA02-0451-4000-B000-000000000000';
export const TEMPERATURE_PERIOD_CHARACTERISTIC_UUID = 'F000AA03-0451-4000-B000-000000000000';

export const createPeripheral: (
  id: string,
  advertisementInterval: number,
) => SimulatedPeripheral = (id, advertisementInterval) => {
  return new SimulatedPeripheral({
    name: 'SensorTag',
    id: id,
    advertisementInterval: advertisementInterval,
    localName: 'SensorTag',
    services: [
      new SimulatedService({
        uuid: TEMPERATURE_SERVICE_UUID,
        isAdvertised: true,
        convenienceName: 'Temperature service',
        characteristics: [
          new SimulatedCharacteristic({
            uuid: TEMPERATURE_DATA_CHARACTERISTIC_UUID,
            initialValue: 'AA==',
            isNotifiable: true,
            convenienceName: 'IR Temperature Data',
            descriptors: [
              new SimulatedDescriptor({
                uuid: '00002901-0000-1000-8000-00805f9b34fb',
                convenienceName: 'Client characteristic configuration',
              }),
              new SimulatedDescriptor({
                uuid: '00002902-0000-1000-8000-00805f9b34fb',
                convenienceName: 'Characteristic user description',
              }),
            ],
          }),
          new SimulatedCharacteristic({
            uuid: TEMPERATURE_CONFIG_CHARACTERISTIC_UUID,
            initialValue: 'AA==',
            convenienceName: 'IR Temperature Config',
          }),
          new SimulatedCharacteristic({
            uuid: TEMPERATURE_PERIOD_CHARACTERISTIC_UUID,
            initialValue: 'AA==',
            convenienceName: 'IR Temperature Period',
          }),
        ],
      }),
    ],
  });
};
