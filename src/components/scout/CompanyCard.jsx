import { useState, useRef } from 'react';

export default function CompanyCard({ company, onSwipe }) {
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;

    // If dragged far enough (>150px), trigger swipe
    if (Math.abs(dragOffset.x) > 150) {
      const direction = dragOffset.x > 0 ? 'right' : 'left';
      onSwipe(direction);
    }

    // Reset
    setIsDragging(false);
    setDragStart(null);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || !dragStart) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStart.x;
    const deltaY = touch.clientY - dragStart.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  const rotation = dragOffset.x * 0.1; // Tilt effect
  const opacity = 1 - Math.abs(dragOffset.x) / 300;

  return (
    <div className="relative">
      {/* Swipe Indicators (Behind Card) */}
      <div className="absolute inset-0 flex items-center justify-between pointer-events-none">
        <div
          className={`text-8xl transition-opacity ${
            dragOffset.x < -50 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          ❌
        </div>
        <div
          className={`text-8xl transition-opacity ${
            dragOffset.x > 50 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          ✅
        </div>
      </div>

      {/* Company Card */}
      <div
        ref={cardRef}
        className="bg-gradient-to-br from-gray-900/90 to-black/90 backdrop-blur-xl rounded-3xl border-2 border-cyan-500/30 overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing"
        style={{
          transform: `translateX(${dragOffset.x}px) translateY(${dragOffset.y * 0.2}px) rotate(${rotation}deg)`,
          opacity: opacity,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="p-10">
          {/* Company Name */}
          <div className="mb-8">
            <h2 className="text-5xl font-bold text-white mb-3 font-mono">
              {company.name}
            </h2>
            {company.domain && (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 text-lg"
                onClick={(e) => e.stopPropagation()}
              >
                🔗 {company.domain}
              </a>
            )}
          </div>

          {/* Company Details Grid - Simplified */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-black/40 rounded-xl p-5 border border-cyan-500/20">
              <p className="text-gray-400 text-sm mb-2 font-mono">INDUSTRY</p>
              <p className="text-white text-lg font-semibold">{company.industry || 'Unknown'}</p>
            </div>

            <div className="bg-black/40 rounded-xl p-5 border border-cyan-500/20">
              <p className="text-gray-400 text-sm mb-2 font-mono">SIZE</p>
              <p className="text-white text-lg font-semibold">
                {company.employee_range || (company.employee_count ? `${company.employee_count.toLocaleString()} employees` : 'Size not available')}
              </p>
            </div>

            <div className="bg-black/40 rounded-xl p-5 border border-cyan-500/20">
              <p className="text-gray-400 text-sm mb-2 font-mono">LOCATION</p>
              <p className="text-white text-lg font-semibold">{company.headquarters_location || 'Location not available'}</p>
            </div>
          </div>

          {/* Links */}
          <div className="flex gap-4 mb-8">
            {company.website_url && (
              <a
                href={company.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-6 py-4 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/30 rounded-xl font-mono font-bold transition-all text-center"
                onClick={(e) => e.stopPropagation()}
              >
                🌐 WEBSITE
              </a>
            )}
            {company.linkedin_url && (
              <a
                href={company.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-6 py-4 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-xl font-mono font-bold transition-all text-center"
                onClick={(e) => e.stopPropagation()}
              >
                💼 LINKEDIN
              </a>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-6">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwipe('left');
              }}
              className="px-8 py-6 bg-red-500/20 hover:bg-red-500/30 text-red-400 border-2 border-red-500/50 rounded-2xl font-mono font-bold text-xl transition-all hover:scale-105"
            >
              ❌ NOT INTERESTED
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwipe('right');
              }}
              className="px-8 py-6 bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 text-green-400 border-2 border-green-500/50 rounded-2xl font-mono font-bold text-xl transition-all hover:scale-105"
            >
              ✅ INTERESTED
            </button>
          </div>
        </div>
      </div>

      {/* Hint Text */}
      <div className="text-center mt-6">
        <p className="text-gray-500 text-sm font-mono">
          💡 Drag the card left or right, or use the buttons
        </p>
      </div>
    </div>
  );
}
