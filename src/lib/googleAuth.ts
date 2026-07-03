/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GoogleUser {
  email?: string;
  name?: string;
  picture?: string;
}

// Read Google OAuth Client ID from environment variables
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Detect if Google OAuth has been configured
export const isGoogleConfigured = !!GOOGLE_CLIENT_ID;

const ACCESS_TOKEN_KEY = 'gdrive_study_access_token';
const TOKEN_EXPIRY_KEY = 'gdrive_study_token_expiry';
const GOOGLE_USER_KEY = 'gdrive_study_google_user';

let cachedAccessToken: string | null = localStorage.getItem(ACCESS_TOKEN_KEY);
let tokenExpiry: number = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0');
let cachedUser: GoogleUser | null = null;

try {
  const storedUser = localStorage.getItem(GOOGLE_USER_KEY);
  if (storedUser) {
    cachedUser = JSON.parse(storedUser);
  }
} catch (e) {
  console.error('Failed to parse cached Google user:', e);
}

// Flag to coordinate listeners during popup flow
let authResolve: ((value: { user: GoogleUser; accessToken: string } | null) => void) | null = null;
let authReject: ((reason: any) => void) | null = null;

// Initialize auth state by validating the existing cached token
export const initAuth = (
  onAuthSuccess: (user: GoogleUser, token: string) => void,
  onAuthFailure: () => void
) => {
  const currentTime = Date.now();
  if (cachedAccessToken && tokenExpiry > currentTime && cachedUser) {
    onAuthSuccess(cachedUser, cachedAccessToken);
    return () => {};
  } else {
    // Clear expired tokens
    clearSession();
    onAuthFailure();
    return () => {};
  }
};

// Clear authentication session cache
export function clearSession() {
  cachedAccessToken = null;
  tokenExpiry = 0;
  cachedUser = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(GOOGLE_USER_KEY);
}

// Fetch Google User Info using the access token
async function fetchGoogleUserInfo(token: string): Promise<GoogleUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch user info from Google');
  }
  const data = await res.json();
  return {
    email: data.email,
    name: data.name,
    picture: data.picture,
  };
}

// Listen for the postMessage event from the pop-up callback page
const handleOauthMessage = async (event: MessageEvent) => {
  // Check that the origin matches our current window's origin
  if (event.origin !== window.location.origin) {
    return;
  }

  if (event.data?.type === 'GOOGLE_OAUTH_SUCCESS' && event.data.accessToken) {
    const token = event.data.accessToken;
    try {
      const userInfo = await fetchGoogleUserInfo(token);
      
      // Store in memory and localStorage (token is usually valid for 3600 seconds)
      cachedAccessToken = token;
      tokenExpiry = Date.now() + 3500 * 1000; // Cache for slightly less than 1 hour
      cachedUser = userInfo;

      localStorage.setItem(ACCESS_TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRY_KEY, tokenExpiry.toString());
      localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(userInfo));

      if (authResolve) {
        authResolve({ user: userInfo, accessToken: token });
      }
    } catch (err) {
      if (authReject) {
        authReject(err);
      }
    } finally {
      cleanupAuthListeners();
    }
  } else if (event.data?.type === 'GOOGLE_OAUTH_FAILURE') {
    if (authReject) {
      authReject(new Error(event.data.error || 'Authentication failed'));
    }
    cleanupAuthListeners();
  }
};

function cleanupAuthListeners() {
  window.removeEventListener('message', handleOauthMessage);
  authResolve = null;
  authReject = null;
}

// Sign in via custom Google OAuth popup
export const googleSignIn = async (): Promise<{ user: GoogleUser; accessToken: string } | null> => {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google Client ID is not configured. Please define VITE_GOOGLE_CLIENT_ID in your AI Studio secrets or environment configuration.');
  }

  // If a flow is already active, cancel it
  cleanupAuthListeners();

  return new Promise((resolve, reject) => {
    authResolve = resolve;
    authReject = reject;

    window.addEventListener('message', handleOauthMessage);

    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents.readonly'
    ].join(' ');

    const width = 550;
    const height = 650;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&prompt=select_account`;

    const popup = window.open(
      authUrl,
      'google_oauth_popup',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no`
    );

    if (!popup) {
      cleanupAuthListeners();
      reject(new Error('Popup was blocked by the browser. Please allow popups to sign in with Google.'));
      return;
    }

    // Monitor for popup closure as a fallback
    const checkClosedInterval = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosedInterval);
        // Delay slightly to allow postMessage to complete if the popup closed itself
        setTimeout(() => {
          if (authResolve) {
            cleanupAuthListeners();
            reject(new Error('Sign-in window was closed before completion.'));
          }
        }, 500);
      }
    }, 1000);
  });
};

export const getAccessToken = async (): Promise<string | null> => {
  const currentTime = Date.now();
  if (cachedAccessToken && tokenExpiry > currentTime) {
    return cachedAccessToken;
  }
  return null;
};

export const logout = async () => {
  clearSession();
};
