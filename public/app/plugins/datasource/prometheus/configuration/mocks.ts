import { DataSourceSettings } from '@grafana/data';

// @todo: replace barrel import path
import { getMockDataSource } from '../../../../features/datasources/__mocks__/index';
import { PromOptions } from '../types';

export function createDefaultConfigOptions(): DataSourceSettings<PromOptions> {
  return getMockDataSource<PromOptions>({
    jsonData: {
      timeInterval: '1m',
      queryTimeout: '1m',
      httpMethod: 'GET',
    },
  });
}
