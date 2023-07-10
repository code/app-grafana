// This import has side effects, and must be at the top so jQuery is made global before
// angular is imported.
import './global-jquery-shim';

import angular from 'angular';

import { EventBusSrv } from '@grafana/data';
import { GrafanaBootConfig } from '@grafana/runtime';
import 'blob-polyfill';
import 'mutationobserver-shim';
import './mocks/workers';

import '../vendor/flot/jquery.flot';
import '../vendor/flot/jquery.flot.time';

const testAppEvents = new EventBusSrv();
const global = window as any;
global.$ = global.jQuery = $;

// mock the default window.grafanaBootData settings
const settings: Partial<GrafanaBootConfig> = {
  angularSupportEnabled: true,
};
global.grafanaBootData = {
  settings,
  user: {},
  navTree: [],
};

// https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
Object.defineProperty(global, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

angular.module('grafana', ['ngRoute']);
angular.module('grafana.services', ['ngRoute', '$strap.directives']);
angular.module('grafana.panels', []);
angular.module('grafana.controllers', []);
angular.module('grafana.directives', []);
angular.module('grafana.filters', []);
angular.module('grafana.routes', ['ngRoute']);

// mock the intersection observer and just say everything is in view
const mockIntersectionObserver = jest
  .fn()
  .mockImplementation((callback: (arg: IntersectionObserverEntry[]) => void) => ({
    observe: jest.fn().mockImplementation((elem: HTMLElement) => {
      callback([{ target: elem, isIntersecting: true }] as unknown as IntersectionObserverEntry[]);
    }),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
global.IntersectionObserver = mockIntersectionObserver;

jest.mock('../app/core/core', () => ({
  ...jest.requireActual('../app/core/core'),
  appEvents: testAppEvents,
}));
jest.mock('../app/angular/partials', () => ({}));
jest.mock('../app/features/plugins/plugin_loader', () => ({}));

const throwUnhandledRejections = () => {
  process.on('unhandledRejection', (err) => {
    throw err;
  });
};

throwUnhandledRejections();

global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
