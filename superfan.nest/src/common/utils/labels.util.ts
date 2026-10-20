import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type LabelValue = string | number | boolean | null | undefined;
type LabelValues = Record<string, LabelValue>;
type LabelsData = {
  wallet?: Record<string, string>;
  methods?: Record<string, string>;
};

function loadLabels(): LabelsData {
  const candidates = [
    resolve(process.cwd(), '../lables.data.json'),
    join(__dirname, '../../../../lables.data.json'),
    join(__dirname, '../../../../../lables.data.json'),
  ];
  const filePath = candidates.find((candidate) => existsSync(candidate));

  if (!filePath) {
    throw new Error('lables.data.json could not be found');
  }

  return JSON.parse(readFileSync(filePath, 'utf8')) as LabelsData;
}

export function renderLabel(template: string, values: LabelValues = {}): string {
  return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

export function getWalletLabel(
  key: string,
  values: LabelValues = {},
): string {
  const template = loadLabels().wallet?.[key] ?? key;
  return renderLabel(template, values);
}

export function getMethodLabel(
  key: string,
  values: LabelValues = {},
): string {
  const template = loadLabels().methods?.[key] ?? key;
  return renderLabel(template, values);
}
