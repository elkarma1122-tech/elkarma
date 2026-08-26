// =====================================================================
// إعدادات فايربيز — بيانات مشروعك الحقيقية (elkarma-47cfd)
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMCQE7Lc5vD2dFGAbayqhfc_kWSyHa5NU",
  authDomain: "elkarma-47cfd.firebaseapp.com",
  databaseURL: "https://elkarma-47cfd-default-rtdb.firebaseio.com", // ⚠️ تأكد من الرابط ده من Console (اقرأ الملاحظة تحت)
  projectId: "elkarma-47cfd",
  storageBucket: "elkarma-47cfd.firebasestorage.app",
  messagingSenderId: "398752188707",
  appId: "1:398752188707:web:41fb3e46a026a24eb4a496",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
