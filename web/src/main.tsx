import React from 'react';
import ReactDOM from 'react-dom/client';
const CurationApp = React.lazy(() => import('./curation/CurationApp'));
const Prototype = React.lazy(async () => {
  await import('./styles.css');
  return import('./App');
});
const PhoneApp = React.lazy(async () => {
  await import('./styles.css');
  return { default: (await import('./phone/PhoneApp')).PhoneApp };
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={<p>Opening workspace…</p>}>
    {location.pathname.startsWith('/curation') ? <CurationApp /> :
      location.pathname.startsWith('/phone') ? <PhoneApp /> : <Prototype />}
  </React.Suspense></React.StrictMode>
);
