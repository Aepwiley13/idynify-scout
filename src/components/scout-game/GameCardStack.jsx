import { useState, useRef } from 'react';
import GameCard from './GameCard';

/**
 * GameCardStack — Container for the swipeable card stack.
 *
 * Manages card transitions and swipe gestures. Reference implementation
 * from CompanyCard.jsx:43-60 (existing touch event handlers).
 *
 * G9: Swipe right = engage flow, swipe left = skip.
 * Touch targets are full-card width for thumb reachability.
 */
export default function GameCardStack({
  cards,
  currentIndex,
  prefetchBuffer,
  sessionMode,
  onEngage,
  onSkip,
  onDefer,
  onIntentOverride
}) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef(null);

  const currentCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];

  if (!currentCard) {
    return (
      <div className="game-card-stack-empty">
        <p>No more cards in this session.</p>
      </div>
    );
  }

  // Swipe gesture handlers — mirrors CompanyCard.jsx:43-60
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    setIsDragging(true);
    dragStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (e) => {
    if (!isDragging || !dragStart.current) return;
    const touch = e.touches[0];
    setDragOffset({
      x: touch.clientX - dragStart.current.x,
      y: touch.clientY - dragStart.current.y
    });
  };

  const handleTouchEnd = () => {
    handleDragEnd();
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart.current) return;
    setDragOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    handleDragEnd();
  };

  const handleDragEnd = () => {
    if (!isDragging) return;

    // Threshold: 120px (slightly less than CompanyCard's 150px for faster game feel)
    if (Math.abs(dragOffset.x) > 120) {
      if (dragOffset.x > 0) {
        // Right swipe — start engage flow (messages already pre-loaded)
        onEngage(currentCard);
      } else {
        // Left swipe — skip
        onSkip(currentCard);
      }
    }

    setIsDragging(false);
    dragStart.current = null;
    setDragOffset({ x: 0, y: 0 });
  };

  // Visual feedback during drag
  const cardStyle = isDragging ? {
    transform: `translateX(${dragOffset.x}px) rotate(${dragOffset.x * 0.05}deg)`,
    transition: 'none'
  } : {
    transform: 'translateX(0) rotate(0)',
    transition: 'transform 0.3s ease'
  };

  // Swipe direction indicator
  const swipeIndicator = isDragging && Math.abs(dragOffset.x) > 50
    ? dragOffset.x > 0 ? 'engage' : 'skip'
    : null;

  const messages = prefetchBuffer?.get(currentCard.id) || null;

  return (
    <div className="game-card-stack">
      {/* Next card (behind, slightly scaled down) */}
      {nextCard && (
        <div className="game-card-next">
          <GameCard
            card={nextCard}
            messages={null}
            sessionMode={sessionMode}
            isBackground
          />
        </div>
      )}

      {/* Current card (interactive) */}
      <div
        className={`game-card-current ${swipeIndicator ? `swipe-${swipeIndicator}` : ''}`}
        style={cardStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {swipeIndicator && (
          <div className={`swipe-indicator swipe-indicator-${swipeIndicator}`}>
            {swipeIndicator === 'engage' ? 'ENGAGE' : 'SKIP'}
          </div>
        )}
        <GameCard
          card={currentCard}
          messages={messages}
          sessionMode={sessionMode}
          onDefer={() => onDefer(currentCard)}
          onIntentOverride={onIntentOverride}
        />
      </div>
    </div>
  );
}
