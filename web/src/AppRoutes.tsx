import { Routes, Route } from 'react-router-dom';
import App from './App';
import Landing from './landing/Landing';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<App />} />
    </Routes>
  );
}
