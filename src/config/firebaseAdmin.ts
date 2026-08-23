import admin from "firebase-admin";

// firebaseConfig.json holds the Firebase service account and is gitignored —
// in deployed environments it does not exist at all, and locally it may be a
// placeholder. Load it lazily and fail soft either way so the server can
// boot without push notifications.
let serviceAccount: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  serviceAccount = require("./firebaseConfig.json");
} catch {
  console.warn(
    "[firebase] firebaseConfig.json not found — push notifications are disabled."
  );
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
  } catch (err) {
    console.warn(
      "[firebase] firebaseConfig.json is a placeholder — push notifications are disabled:",
      (err as Error).message
    );
  }
}
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: serviceAccount?.project_id || "ollo-local-placeholder",
  });
}

export default admin;
