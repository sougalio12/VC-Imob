function isDemoMode() {
  return sessionStorage.getItem("vc-imob-demo") === "true";
}

function enterDemoMode() {
  sessionStorage.setItem("vc-imob-demo", "true");
  clearStoredSession();
}

function leaveDemoMode() {
  sessionStorage.removeItem("vc-imob-demo");
}

function isAuthenticated() {
  return isDemoMode() || Boolean(getStoredSession()?.access_token);
}

async function requireCrmSession() {
  if (isDemoMode()) return true;
  if (await getValidSession()) return true;

  window.location.replace("./login.html");
  return false;
}

async function logoutCrm() {
  leaveDemoMode();
  await signOutFromSupabase();
  window.location.replace("./login.html");
}
