export type AuthStatus = 'signed-out' | 'signing-in' | 'signed-in' | 'error';
export type AuthSnapshot = { status: AuthStatus; profile?: { name: string; email?: string }; error?: string };
type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string; error_uri?: string; state?: string };
type TokenClient = { requestAccessToken: (options?: { prompt?: string; hint?: string }) => void };
type Gis = { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: { type?: string; message?: string }) => void }) => TokenClient; revoke: (token: string, callback?: () => void) => void } };
declare global { interface Window { google?: { accounts?: { oauth2?: Gis['oauth2'] } } } }

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let tokenClient: TokenClient | undefined;
let accessToken: string | undefined;
let tokenExpiry = 0;
let authState: AuthSnapshot = { status: 'signed-out' };
const listeners = new Set<(state: AuthSnapshot) => void>();
let gisPromise: Promise<Gis['oauth2']> | undefined;

export class AuthError extends Error { constructor(message: string) { super(message); this.name = 'AuthError'; } }

function publish(next: AuthSnapshot): void { authState = next; listeners.forEach((listener) => listener(authState)); }

export function formatGoogleAuthError(response: TokenResponse, origin = window.location.origin): string {
  const detail = `${response.error ?? ''} ${response.error_description ?? ''}`.toLowerCase();
  if (/origin|referrer|unauthorized_client/.test(detail)) return `Google rejected this app origin. Add this origin to the existing OAuth client in Google Cloud Console: ${origin}`;
  if (/popup|closed|blocked/.test(detail)) return 'The Google sign-in popup could not open. Allow popups for this site, then try again.';
  if (/access_denied/.test(detail)) return 'Google access was not granted. You can keep using Salary Reset offline.';
  if (/invalid_grant/.test(detail)) return 'Google access was revoked or expired. Sign in again to reconnect Drive.';
  if (!navigator.onLine) return 'You are offline. Your data is safe here; reconnect to sign in.';
  return response.error_description || response.error || 'Google sign-in did not complete. Try again.';
}

async function loadGis(): Promise<Gis['oauth2']> {
  const current = window.google?.accounts?.oauth2;
  if (current) return current;
  gisPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-gis]');
    const script = existing ?? document.createElement('script');
    const fail = () => reject(new Error('Google Identity Services could not load. Check your connection and allow accounts.google.com.'));
    script.addEventListener('load', () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2); else fail();
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existing) { script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.dataset.googleGis = 'true'; document.head.append(script); }
  });
  return gisPromise;
}

function clientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!id) throw new Error('Google Drive sync needs VITE_GOOGLE_CLIENT_ID in your local .env file. Offline use is still available.');
  return id;
}

export const googleAuth = {
  getSnapshot: () => authState,
  onAuthChange(listener: (state: AuthSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  isSignedIn: () => Boolean(accessToken && tokenExpiry > Date.now()),
  async signIn(): Promise<void> {
    publish({ status: 'signing-in' });
    try {
      const oauth = await loadGis();
      tokenClient = oauth.initTokenClient({
        client_id: clientId(), scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) { publish({ status: 'error', error: formatGoogleAuthError(response) }); return; }
          accessToken = response.access_token; tokenExpiry = Date.now() + Number(response.expires_in ?? 3600) * 1000;
          publish({ status: 'signed-in', profile: { name: 'Google Drive connected' } });
        },
        error_callback: (error) => publish({ status: 'error', error: error.type === 'popup_failed_to_open' ? 'The Google sign-in popup was blocked. Allow popups for this site, then try again.' : error.message ?? 'Google sign-in failed.' }),
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (error) { publish({ status: 'error', error: error instanceof Error ? error.message : 'Google sign-in failed.' }); }
  },
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && accessToken && tokenExpiry > Date.now() + 60_000) return accessToken;
    if (!tokenClient) { if (accessToken) throw new AuthError('Google access expired. Sign in again to reconnect Drive.'); throw new AuthError('Sign in with Google to sync.'); }
    return new Promise((resolve, reject) => {
      // GIS token model refreshes previously approved scopes with prompt="" without saving the token.
      const oauth = window.google?.accounts?.oauth2;
      if (!oauth) { reject(new AuthError('Google Identity Services is unavailable. Sign in again.')); return; }
      tokenClient = oauth.initTokenClient({
        client_id: clientId(), scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            const message = formatGoogleAuthError(response); accessToken = undefined; tokenExpiry = 0;
            publish({ status: 'error', error: message }); reject(new AuthError(message)); return;
          }
          accessToken = response.access_token; tokenExpiry = Date.now() + Number(response.expires_in ?? 3600) * 1000;
          publish({ status: 'signed-in', profile: { name: 'Google Drive connected' } }); resolve(accessToken);
        },
        error_callback: (error) => { const message = error.message ?? 'Google token refresh failed.'; publish({ status: 'error', error: message }); reject(new AuthError(message)); },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  },
  signOut(): void { accessToken = undefined; tokenExpiry = 0; tokenClient = undefined; publish({ status: 'signed-out' }); },
  async revoke(): Promise<void> {
    if (!accessToken) { this.signOut(); return; }
    const oauth = await loadGis();
    const oldToken = accessToken;
    await new Promise<void>((resolve) => oauth.revoke(oldToken, resolve));
    this.signOut();
  },
};
