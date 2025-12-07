import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

export default function Questionnaire() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({
    whatYouSell: '',
    whoBuys: '',
    priceRange: '',
    industries: '',
    companySize: '',
    websiteUrl: ''
  });

  const questions = [
    {
      id: 'whatYouSell',
      question: '1. What do you sell?',
      placeholder: 'e.g., Marketing automation software for dentists',
      tip: 'Be specific! The more detail, the better your leads.'
    },
    {
      id: 'whoBuys',
      question: '2. Who typically buys it? (Job titles)',
      placeholder: 'e.g., Marketing Director, Practice Owner, Office Manager',
      tip: 'Think about who has the authority and budget.'
    },
    {
      id: 'priceRange',
      question: "3. What's your price range?",
      placeholder: 'e.g., $2,000 - $10,000 per year',
      tip: 'This helps us filter by company budget.'
    },
    {
      id: 'industries',
      question: '4. Any specific industries?',
      placeholder: 'e.g., Healthcare, Dental, Medical Practices',
      tip: 'Leave blank for all industries.'
    },
    {
      id: 'companySize',
      question: '5. Preferred company size?',
      placeholder: 'e.g., 10-50 employees',
      tip: 'Smaller companies decide faster, larger have bigger budgets.'
    },
    {
      id: 'websiteUrl',
      question: '6. Your company website?',
      placeholder: 'e.g., https://yourcompany.com',
      tip: 'Barry will analyze your site to better understand your value proposition.'
    }
  ];

  const currentQuestion = questions[step - 1];

  const handleNext = () => {
    if (answers[currentQuestion.id].trim() === '') {
      alert('⚠️ Please answer this question before proceeding');
      return;
    }
    if (step < 6) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (answers[currentQuestion.id].trim() === '') {
      alert('⚠️ Please answer this question before submitting');
      return;
    }

    try {
      await setDoc(doc(db, 'icpData', auth.currentUser.uid), {
        userId: auth.currentUser.uid,
        tier: 'scout',
        answers: answers,
        createdAt: new Date()
      });

      navigate('/dashboard');
    } catch (error) {
      console.error('Error saving ICP:', error);
      alert('⚠️ Error saving. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Starfield Background */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(150)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      {/* Top Status Bar */}
      <div className="absolute top-6 left-6 text-cyan-400 font-mono text-xs space-y-1 z-20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>MISSION ACTIVE</span>
        </div>
        <div>PHASE: ICP CALIBRATION</div>
        <div>PROGRESS: {step}/6</div>
      </div>

      <div className="relative z-10 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">🎯</div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              ICP Mission Briefing
            </h1>
            <p className="text-cyan-300 text-lg font-mono">
              Help Barry AI understand your ideal customer profile
            </p>
          </div>

          {/* Progress Bar */}
          <div className="bg-cyan-950/30 rounded-full h-4 mb-8 border border-cyan-500/30 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 h-4 transition-all duration-500 ease-out"
              style={{ width: `${(step / 6) * 100}%` }}
            />
          </div>

          {/* Question Card */}
          <div className="bg-black/60 backdrop-blur-xl rounded-3xl shadow-2xl p-10 border border-cyan-500/30 mb-6">
            <div className="mb-6">
              <h2 className="text-3xl font-bold text-white mb-3">
                {currentQuestion.question}
              </h2>
              <p className="text-cyan-400 text-sm font-mono flex items-center gap-2">
                <span>💡</span> {currentQuestion.tip}
              </p>
            </div>

            <textarea
              value={answers[currentQuestion.id]}
              onChange={(e) => setAnswers({
                ...answers,
                [currentQuestion.id]: e.target.value
              })}
              placeholder={currentQuestion.placeholder}
              className="w-full h-40 px-6 py-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-lg text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all resize-none font-mono"
              autoFocus
            />

            {/* Navigation Buttons */}
            <div className="flex gap-4 mt-6">
              {step > 1 && (
                <button
                  onClick={handleBack}
                  className="px-8 py-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-cyan-400 font-bold hover:bg-cyan-900/50 transition-all"
                >
                  ← Back
                </button>
              )}
              
              {step < 6 ? (
                <button
                  onClick={handleNext}
                  className="flex-1 bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:scale-[1.02] transition-all shadow-lg"
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  className="flex-1 bg-gradient-to-r from-pink-500 via-purple-600 to-cyan-500 text-white px-8 py-4 rounded-xl font-bold text-lg hover:scale-[1.02] transition-all shadow-lg animate-pulse"
                >
                  🚀 Complete Mission
                </button>
              )}
            </div>
          </div>

          {/* Question Navigation Dots */}
          <div className="flex justify-center gap-3">
            {questions.map((_, index) => (
              <button
                key={index}
                onClick={() => setStep(index + 1)}
                className={`w-3 h-3 rounded-full transition-all ${
                  index + 1 === step
                    ? 'bg-cyan-400 w-8'
                    : index + 1 < step
                    ? 'bg-green-500'
                    : 'bg-cyan-900'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}