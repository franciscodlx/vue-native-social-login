import {
  createEntraNativeAuth,
  type EntraNativeAuthConfig,
} from '@franciscodlxdev/vue-native-entra-native-auth';
import { APP_CALLBACKS, ENTRA, HOST } from './config';

export const ENTRA_REAL = ENTRA.clientId !== '';

const config: EntraNativeAuthConfig = ENTRA_REAL
  ? { tenantSubdomain: ENTRA.tenantSubdomain, clientId: ENTRA.clientId }
  : {
      tenantSubdomain: 'mock-tenant',
      clientId: 'mock-entra-client',
      baseUrl: `http://${HOST}:4700/mock-tenant`,
    };

export const entra = createEntraNativeAuth(config);
export const ENTRA_REDIRECT_URI = APP_CALLBACKS.entra;

/** Accounts the mock knows (tools/mock-entra). */
export const ENTRA_DEMO = ENTRA_REAL
  ? { email: '', password: '', code: '' }
  : { email: 'ada@example.com', password: 'Passw0rd!', code: '12345678' };
