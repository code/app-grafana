import React from 'react';
import { render, waitFor, userEvent, screen } from 'test/test-utils';
import { byLabelText, byPlaceholderText, byRole, byTestId, byText } from 'testing-library-selector';

import { dateTime } from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { config, locationService, setDataSourceSrv } from '@grafana/runtime';
import { contextSrv } from 'app/core/services/context_srv';
import { setupMswServer } from 'app/features/alerting/unified/mockApi';
import { parseMatchers } from 'app/features/alerting/unified/utils/alertmanager';
import { AlertState, MatcherOperator, SilenceState } from 'app/plugins/datasource/alertmanager/types';
import { AccessControlAction } from 'app/types';

import Silences from './Silences';
import { fetchAlerts } from './api/alertmanager';
import { grantUserPermissions, mockAlertmanagerAlert, mockDataSource, MockDataSourceSrv, mockSilence } from './mocks';
import { AlertmanagerProvider } from './state/AlertmanagerContext';
import { setupDataSources } from './testSetup/datasources';
import { DataSourceType } from './utils/datasource';

// jest.mock('./api/alertmanager');
jest.mock('app/core/services/context_srv');

const TEST_TIMEOUT = 60000;
const mocks = {
  contextSrv: jest.mocked(contextSrv),
};

const renderSilences = (location = '/alerting/silences/') => {
  return render(
    <AlertmanagerProvider accessType="instance">
      <Silences />
    </AlertmanagerProvider>,
    {
      routerOptions: {
        initialEntries: [location],
      },
    }
  );
};

const dataSources = {
  am: mockDataSource({
    name: 'Alertmanager',
    type: DataSourceType.Alertmanager,
  }),
};

const ui = {
  notExpiredTable: byTestId('not-expired-table'),
  expiredTable: byTestId('expired-table'),
  expiredCaret: byText(/expired silences \(/i),
  silenceRow: byTestId('row'),
  silencedAlertCell: byTestId('alerts'),
  addSilenceButton: byRole('link', { name: /add silence/i }),
  queryBar: byPlaceholderText('Search'),
  editor: {
    timeRange: byTestId(selectors.components.TimePicker.openButton),
    durationField: byLabelText('Duration'),
    durationInput: byRole('textbox', { name: /duration/i }),
    matchersField: byTestId('matcher'),
    matcherName: byPlaceholderText('label'),
    matcherValue: byPlaceholderText('value'),
    comment: byPlaceholderText('Details about the silence'),
    matcherOperatorSelect: byLabelText('operator'),
    matcherOperator: (operator: MatcherOperator) => byText(operator, { exact: true }),
    addMatcherButton: byRole('button', { name: 'Add matcher' }),
    submit: byText(/save silence/i),
    createdBy: byText(/created by \*/i),
  },
};

// const MOCK_SILENCE_ID_1 = '12345';

const resetMocks = () => {
  jest.resetAllMocks();
  // mocks.api.fetchSilences.mockImplementation(() => {
  //   return Promise.resolve([
  //     mockSilence({ id: MOCK_SILENCE_ID_1 }),
  //     mockSilence({ id: '67890', matchers: parseMatchers('foo!=bar'), comment: 'Catch all' }),
  //     mockSilence({ id: '1111', status: { state: SilenceState.Expired } }),
  //   ]);
  // });

  grantUserPermissions([
    AccessControlAction.AlertingInstanceRead,
    AccessControlAction.AlertingInstanceCreate,
    AccessControlAction.AlertingInstanceUpdate,
    AccessControlAction.AlertingInstancesExternalRead,
    AccessControlAction.AlertingInstancesExternalWrite,
  ]);
};

const setUserLogged = (isLogged: boolean) => {
  config.bootData.user.isSignedIn = isLogged;
  config.bootData.user.name = isLogged ? 'admin' : '';
};

const enterSilenceLabel = async (index: number, name: string, matcher: MatcherOperator, value: string) => {
  const user = userEvent.setup();
  await user.type(ui.editor.matcherName.getAll()[index], name);
  await user.type(ui.editor.matcherOperatorSelect.getAll()[index], matcher);
  await user.tab();
  await user.type(ui.editor.matcherValue.getAll()[index], value);
};

const addAdditionalMatcher = async () => {
  const user = userEvent.setup();
  await user.click(ui.editor.addMatcherButton.get());
};

setupMswServer();

describe('Silences', () => {
  beforeAll(resetMocks);
  afterEach(resetMocks);

  beforeEach(() => {
    setDataSourceSrv(new MockDataSourceSrv(dataSources));
  });

  it(
    'loads and shows silences',
    async () => {
      const user = userEvent.setup();
      renderSilences();

      expect(await ui.notExpiredTable.find()).toBeInTheDocument();

      await user.click(ui.expiredCaret.get());
      expect(ui.expiredTable.get()).toBeInTheDocument();

      const allSilences = ui.silenceRow.queryAll();
      expect(allSilences).toHaveLength(3);
      expect(allSilences[0]).toHaveTextContent('foo=bar');
      expect(allSilences[1]).toHaveTextContent('foo!=bar');
      expect(allSilences[2]).toHaveTextContent('foo=bar');

      await user.click(ui.expiredCaret.get());

      expect(ui.notExpiredTable.get()).toBeInTheDocument();
      expect(ui.expiredTable.query()).not.toBeInTheDocument();

      const activeSilences = ui.silenceRow.queryAll();
      expect(activeSilences).toHaveLength(2);
      expect(activeSilences[0]).toHaveTextContent('foo=bar');
      expect(activeSilences[1]).toHaveTextContent('foo!=bar');
    },
    TEST_TIMEOUT
  );

  fit(
    'shows the correct number of silenced alerts',
    async () => {
      // mocks.api.fetchAlerts.mockImplementation(() => {
      //   return Promise.resolve([
      //     mockAlertmanagerAlert({
      //       labels: { foo: 'bar', buzz: 'bazz' },
      //       status: { state: AlertState.Suppressed, silencedBy: [MOCK_SILENCE_ID_1], inhibitedBy: [] },
      //     }),
      //     mockAlertmanagerAlert({
      //       labels: { foo: 'bar', buzz: 'bazz' },
      //       status: { state: AlertState.Suppressed, silencedBy: [MOCK_SILENCE_ID_1], inhibitedBy: [] },
      //     }),
      //   ]);
      // });

      renderSilences();

      expect(await ui.notExpiredTable.find()).toBeInTheDocument();

      screen.debug(undefined, Infinity);

      // await waitFor(async () =>
      //   expect(await ui.silencedAlertCell.findAll(await ui.notExpiredTable.find())).toHaveLength(2)
      // );
      const silencedAlertRows = await ui.silencedAlertCell.findAll(await ui.notExpiredTable.find());
      expect(silencedAlertRows[0]).toHaveTextContent('2');
      expect(silencedAlertRows[1]).toHaveTextContent('0');
    },
    TEST_TIMEOUT
  );

  it(
    'filters silences by matchers',
    async () => {
      renderSilences();
      // await waitFor(() => expect(mocks.api.fetchSilences).toHaveBeenCalled());
      // await waitFor(() => expect(mocks.api.fetchAlerts).toHaveBeenCalled());

      const queryBar = ui.queryBar.get();
      await userEvent.type(queryBar, 'foo=bar');

      await waitFor(() => expect(ui.silenceRow.getAll()).toHaveLength(2));
    },
    TEST_TIMEOUT
  );

  it('shows creating a silence button for users with access', async () => {
    renderSilences();

    // await waitFor(() => expect(mocks.api.fetchSilences).toHaveBeenCalled());
    // await waitFor(() => expect(mocks.api.fetchAlerts).toHaveBeenCalled());

    expect(ui.addSilenceButton.get()).toBeInTheDocument();
  });

  it('hides actions for creating a silence for users without access', async () => {
    grantUserPermissions([AccessControlAction.AlertingInstanceRead, AccessControlAction.AlertingInstancesExternalRead]);

    renderSilences();
    // await waitFor(() => expect(mocks.api.fetchSilences).toHaveBeenCalled());
    // await waitFor(() => expect(mocks.api.fetchAlerts).toHaveBeenCalled());

    expect(ui.addSilenceButton.query()).not.toBeInTheDocument();
  });
});

describe('Silence edit', () => {
  const baseUrlPath = '/alerting/silence/new';
  beforeAll(resetMocks);
  afterEach(resetMocks);

  beforeEach(() => {
    setUserLogged(true);
    setupDataSources(dataSources.am);
  });

  it('Should not render createdBy if user is logged in and has a name', async () => {
    renderSilences(baseUrlPath);
    await waitFor(() => expect(ui.editor.createdBy.query()).not.toBeInTheDocument());
  });
  it('Should render createdBy if user is not logged or has no name', async () => {
    setUserLogged(false);
    renderSilences(baseUrlPath);
    await waitFor(() => expect(ui.editor.createdBy.get()).toBeInTheDocument());
  });
  it(
    'prefills the matchers field with matchers params',
    async () => {
      const matchersParams = ['foo=bar', 'bar=~ba.+', 'hello!=world', 'cluster!~us-central.*'];
      const matchersQueryString = matchersParams.map((matcher) => `matcher=${encodeURIComponent(matcher)}`).join('&');

      renderSilences(`${baseUrlPath}?${matchersQueryString}`);
      expect(await ui.editor.durationField.find()).toBeInTheDocument();

      const matchers = ui.editor.matchersField.queryAll();
      expect(matchers).toHaveLength(4);

      expect(ui.editor.matcherName.query(matchers[0])).toHaveValue('foo');
      expect(ui.editor.matcherOperator(MatcherOperator.equal).query(matchers[0])).not.toBeNull();
      expect(ui.editor.matcherValue.query(matchers[0])).toHaveValue('bar');

      expect(ui.editor.matcherName.query(matchers[1])).toHaveValue('bar');
      expect(ui.editor.matcherOperator(MatcherOperator.regex).query(matchers[1])).not.toBeNull();
      expect(ui.editor.matcherValue.query(matchers[1])).toHaveValue('ba.+');

      expect(ui.editor.matcherName.query(matchers[2])).toHaveValue('hello');
      expect(ui.editor.matcherOperator(MatcherOperator.notEqual).query(matchers[2])).not.toBeNull();
      expect(ui.editor.matcherValue.query(matchers[2])).toHaveValue('world');

      expect(ui.editor.matcherName.query(matchers[3])).toHaveValue('cluster');
      expect(ui.editor.matcherOperator(MatcherOperator.notRegex).query(matchers[3])).not.toBeNull();
      expect(ui.editor.matcherValue.query(matchers[3])).toHaveValue('us-central.*');
    },
    TEST_TIMEOUT
  );

  it(
    'creates a new silence',
    async () => {
      renderSilences(baseUrlPath);
      expect(await ui.editor.durationField.find()).toBeInTheDocument();

      const start = new Date();
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

      const startDateString = dateTime(start).format('YYYY-MM-DD');
      const endDateString = dateTime(end).format('YYYY-MM-DD');

      await userEvent.clear(ui.editor.durationInput.get());
      await userEvent.type(ui.editor.durationInput.get(), '1d');

      await waitFor(() => expect(ui.editor.durationInput.query()).toHaveValue('1d'));
      await waitFor(() => expect(ui.editor.timeRange.get()).toHaveTextContent(startDateString));
      await waitFor(() => expect(ui.editor.timeRange.get()).toHaveTextContent(endDateString));

      await enterSilenceLabel(0, 'foo', MatcherOperator.equal, 'bar');

      await addAdditionalMatcher();
      await enterSilenceLabel(1, 'bar', MatcherOperator.notEqual, 'buzz');

      await addAdditionalMatcher();
      await enterSilenceLabel(2, 'region', MatcherOperator.regex, 'us-west-.*');

      await addAdditionalMatcher();
      await enterSilenceLabel(3, 'env', MatcherOperator.notRegex, 'dev|staging');

      await userEvent.click(ui.editor.submit.get());

      // await waitFor(() =>
      //   expect(mocks.api.createOrUpdateSilence).toHaveBeenCalledWith(
      //     'grafana',
      //     expect.objectContaining({
      //       comment: expect.stringMatching(/created (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/),
      //       matchers: [
      //         { isEqual: true, isRegex: false, name: 'foo', value: 'bar' },
      //         { isEqual: false, isRegex: false, name: 'bar', value: 'buzz' },
      //         { isEqual: true, isRegex: true, name: 'region', value: 'us-west-.*' },
      //         { isEqual: false, isRegex: true, name: 'env', value: 'dev|staging' },
      //       ],
      //     })
      //   )
      // );
    },
    TEST_TIMEOUT
  );

  it(
    'silences page should contain alertmanager parameter after creating a silence',
    async () => {
      const user = userEvent.setup();

      renderSilences(`${baseUrlPath}?alertmanager=Alertmanager`);
      await waitFor(() => expect(ui.editor.durationField.query()).not.toBeNull());

      await enterSilenceLabel(0, 'foo', MatcherOperator.equal, 'bar');

      await user.click(ui.editor.submit.get());

      await waitFor(() =>
        expect(mocks.api.createOrUpdateSilence).toHaveBeenCalledWith(
          'Alertmanager',
          expect.objectContaining({
            matchers: [{ isEqual: true, isRegex: false, name: 'foo', value: 'bar' }],
          })
        )
      );

      expect(locationService.getSearch().get('alertmanager')).toBe('Alertmanager');
    },
    TEST_TIMEOUT
  );
});
