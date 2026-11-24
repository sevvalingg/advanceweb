import { PanelPlugin } from '@grafana/data';
import { SimpleOptions } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions>(SimplePanel).setPanelOptions((builder) => {
  return builder
    .addNumberInput({
      path: 'goodBandCm',
      name: 'İyi bölge (cm)',
      description: 'Sapma bu değerin altındaysa araç şeritte iyi gidiyor sayılır',
      defaultValue: 10,
    })
    .addNumberInput({
      path: 'jumpThresholdCm',
      name: 'Zıplama eşiği (cm)',
      description: 'Art arda iki ölçüm arasındaki fark bundan büyükse zıplama olarak işaretlenir',
      defaultValue: 10,
    })
    .addBooleanSwitch({
      path: 'invertOffset',
      name: 'Sapma işaretini ters çevir',
      description: 'Veri kaynağında pozitif sapma araç sağda demekse açın (ortak formatta pozitif = araç solda)',
      defaultValue: false,
    });
});
