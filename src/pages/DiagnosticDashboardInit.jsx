import { useState } from 'react';
import { auth } from '../firebase/config';
import { initializeDashboard, getDashboardState } from '../utils/dashboardUtils';

export default function DiagnosticDashboardInit() {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [dashboardData, setDashboardData] = useState(null);

  const handleInitialize = async () => {
    try {
      setStatus('Starting initialization...');
      setError('');

      const user = auth.currentUser;
      if (!user) {
        setError('No user logged in');
        return;
      }

      setStatus(`Initializing dashboard for user: ${user.uid}`);
      const result = await initializeDashboard(user.uid);

      setStatus(`✅ Initialization complete! Result: ${JSON.stringify(result)}`);

      // Load the dashboard to verify
      const dashboard = await getDashboardState(user.uid);
      setDashboardData(dashboard);

    } catch (err) {
      setError(`❌ Error: ${err.message}`);
      console.error('Full error:', err);
    }
  };

  const handleCheckDashboard = async () => {
    try {
      setStatus('Checking dashboard...');
      setError('');

      const user = auth.currentUser;
      if (!user) {
        setError('No user logged in');
        return;
      }

      const dashboard = await getDashboardState(user.uid);
      if (dashboard) {
        setStatus('✅ Dashboard exists!');
        setDashboardData(dashboard);
      } else {
        setStatus('❌ Dashboard does not exist');
      }
    } catch (err) {
      setError(`❌ Error: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Dashboard Diagnostic Tool</h1>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Actions</h2>
          <div className="space-x-4">
            <button
              onClick={handleCheckDashboard}
              className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
            >
              Check Dashboard
            </button>
            <button
              onClick={handleInitialize}
              className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600"
            >
              Initialize Dashboard
            </button>
          </div>
        </div>

        {status && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-2">Status:</h3>
            <p className="whitespace-pre-wrap">{status}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-2">Error:</h3>
            <p className="text-red-600">{error}</p>
            <p className="text-sm mt-2 text-gray-600">
              If you see "Missing or insufficient permissions", the Firestore security rules need to be deployed.
            </p>
          </div>
        )}

        {dashboardData && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Dashboard Data:</h3>
            <pre className="text-xs overflow-auto">{JSON.stringify(dashboardData, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
