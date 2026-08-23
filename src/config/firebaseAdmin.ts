import admin from "firebase-admin";
import serviceAccount from "./firebaseConfig.json";

// firebaseConfig.json may be a local placeholder (the real service account is not
// committed). Fail soft so the server can boot without push notifications.
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
} catch (err) {
  console.warn(
    "[firebase] firebaseConfig.json is missing or a placeholder — push notifications are disabled:",
    (err as Error).message
  );
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: serviceAccount.project_id });
  }
}

export default admin;
