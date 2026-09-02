import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCs3KLVBY4tPrWhK7gDATX1H0drvjzD2_E",
  authDomain: "elkarma-1d3d0.firebaseapp.com",
  databaseURL: "https://elkarma-1d3d0-default-rtdb.firebaseio.com",
  projectId: "elkarma-1d3d0",
  storageBucket: "elkarma-1d3d0.firebasestorage.app",
  messagingSenderId: "719790503287",
  appId: "1:719790503287:web:dea5a8f7489b00dead5d72"
};

// 1. تهيئة التطبيق
const app = initializeApp(firebaseConfig);

// 2. تصدير auth و db ليتمكن app.js من استيرادهما
export const auth = getAuth(app);
export const db = getDatabase(app);
export default app;
