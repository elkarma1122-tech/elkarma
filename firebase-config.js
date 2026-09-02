// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCs3KLVBY4tPrWhK7gDATX1H0drvjzD2_E",
  authDomain: "elkarma-1d3d0.firebaseapp.com",
  projectId: "elkarma-1d3d0",
  storageBucket: "elkarma-1d3d0.firebasestorage.app",
  messagingSenderId: "719790503287",
  appId: "1:719790503287:web:dea5a8f7489b00dead5d72",
  measurementId: "G-77QDME87VF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
