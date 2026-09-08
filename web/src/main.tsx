import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PhoneApp } from './phone/PhoneApp';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname.startsWith('/phone') ? <PhoneApp /> : <App />}</React.StrictMode>);
