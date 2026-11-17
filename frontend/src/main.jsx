import React from 'react';
import { createRoot } from 'react-dom/client';
import ClaimAssessment from './ClaimAssessment.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClaimAssessment />
  </React.StrictMode>,
);
