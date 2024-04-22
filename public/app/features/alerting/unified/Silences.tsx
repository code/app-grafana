import React from 'react';
import { Route, RouteChildrenProps, Switch } from 'react-router-dom';

import { withErrorBoundary } from '@grafana/ui';

import { AlertmanagerPageWrapper } from './components/AlertingPageWrapper';
import { GrafanaAlertmanagerDeliveryWarning } from './components/GrafanaAlertmanagerDeliveryWarning';
import SilencesEditor from './components/silences/SilencesEditor';
import SilencesTable from './components/silences/SilencesTable';
import { useSilenceNavData } from './hooks/useSilenceNavData';
import { useUnifiedAlertingSelector } from './hooks/useUnifiedAlertingSelector';
import { useAlertmanager } from './state/AlertmanagerContext';
import { initialAsyncRequestState } from './utils/redux';

const Silences = () => {
  const { selectedAlertmanager } = useAlertmanager();

  const alertsRequests = useUnifiedAlertingSelector((state) => state.amAlerts);
  const alertsRequest = selectedAlertmanager
    ? alertsRequests[selectedAlertmanager] || initialAsyncRequestState
    : undefined;

  if (!selectedAlertmanager) {
    return null;
  }

  return (
    <>
      <GrafanaAlertmanagerDeliveryWarning currentAlertmanager={selectedAlertmanager} />

      <Switch>
        <Route exact path="/alerting/silences">
          <SilencesTable
            alertManagerAlerts={alertsRequest?.result ?? []}
            alertManagerSourceName={selectedAlertmanager}
          />
        </Route>
        <Route exact path="/alerting/silence/new">
          <SilencesEditor alertManagerSourceName={selectedAlertmanager} />
        </Route>
        <Route exact path="/alerting/silence/:id/edit">
          {({ match }: RouteChildrenProps<{ id: string }>) => {
            return (
              match?.params.id && (
                <SilencesEditor silenceId={match.params.id} alertManagerSourceName={selectedAlertmanager} />
              )
            );
          }}
        </Route>
      </Switch>
    </>
  );
};

function SilencesPage() {
  const pageNav = useSilenceNavData();

  return (
    <AlertmanagerPageWrapper navId="silences" pageNav={pageNav} accessType="instance">
      <Silences />
    </AlertmanagerPageWrapper>
  );
}

export default withErrorBoundary(SilencesPage, { style: 'page' });
