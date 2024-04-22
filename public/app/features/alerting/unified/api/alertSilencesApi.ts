import { alertingApi } from './alertingApi';

export const alertSilencesApi = alertingApi.injectEndpoints({
  endpoints: (build) => ({
    getSilences: build.query<
      any[],
      {
        datasourceUid: string;
      }
    >({
      query: ({ datasourceUid }) => {
        return {
          url: `/api/alertmanager/${datasourceUid}/api/v2/silences`,
        };
      },
      providesTags: ['AlertSilences'],
    }),

    getSilence: build.query<
      any,
      {
        datasourceUid: string;
        id: string;
      }
    >({
      query: ({ datasourceUid, id }) => ({
        url: `/api/alertmanager/${datasourceUid}/api/v2/silence/${id}`,
      }),
      providesTags: ['AlertSilences'],
    }),

    createSilence: build.mutation<
      any,
      {
        datasourceUid: string;
        payload: any;
      }
    >({
      query: ({ datasourceUid, payload }) => ({
        url: `/api/alertmanager/${datasourceUid}/api/v2/silences`,
        method: 'POST',
        data: payload,
      }),
      invalidatesTags: ['AlertSilences'],
    }),

    expireSilence: build.mutation<
      any,
      {
        datasourceUid: string;
        silenceId: string;
      }
    >({
      query: ({ datasourceUid, silenceId }) => ({
        url: `/api/alertmanager/${datasourceUid}/api/v2/silence/${encodeURIComponent(silenceId)}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['AlertSilences'],
    }),
  }),
});
