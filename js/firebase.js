// firebase.js — inizializza Firebase (Auth + Firestore) e riesporta le funzioni usate.
// La config non è segreta: la sicurezza è data da login + regole Firestore.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDocs, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCU5ZuzB--GTBhRs6LpaPBbZMTIzsgicII',
  authDomain: 'palladino-24b03.firebaseapp.com',
  projectId: 'palladino-24b03',
  storageBucket: 'palladino-24b03.firebasestorage.app',
  messagingSenderId: '1017482031863',
  appId: '1:1017482031863:web:290633725fa30f555659f2',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let _db;
try {
  _db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
} catch (e) {
  console.warn('Cache offline non attiva, uso Firestore standard:', e);
  _db = getFirestore(app);
}
export const db = _db;

export const ADMIN_EMAIL = 'massimiliano.palladino@mafaldaindustries.com';

export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDocs, writeBatch,
};
