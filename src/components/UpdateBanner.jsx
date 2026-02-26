import React from 'react';
import { RefreshCw, Zap } from 'lucide-react';

/**
 * Shown at the top of the app when a new platform version has been deployed.
 * The user clicks "Refresh now" to reload and get the latest build.
 */
const UpdateBanner = () => {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, #0e7490 0%, #164e63 100%)',
        borderBottom: '1px solid #22d3ee',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0f2fe',
      }}
    >
      <Zap className="w-4 h-4 text-cyan-300 flex-shrink-0" />
      <span>
        A new version of the platform is available.
      </span>
      <button
        onClick={handleRefresh}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#22d3ee',
          color: '#0a0a0a',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 14px',
          fontFamily: 'monospace',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <RefreshCw className="w-3 h-3" />
        Refresh now
      </button>
    </div>
  );
};

export default UpdateBanner;
