import { useNavigate } from 'react-router-dom';
import { Target, Users, TrendingUp, Zap, ArrowRight, CheckCircle } from 'lucide-react';
import './GettingStarted.css';

export default function GettingStarted() {
  const navigate = useNavigate();

  return (
    <div className="getting-started-page">
      {/* Header */}
      <div className="gs-header">
        <div className="gs-header-content">
          <div className="gs-bear">🐻</div>
          <h1 className="gs-title">Welcome to IDYNIFY</h1>
          <p className="gs-subtitle">Let's get you set up in under 5 minutes</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="gs-content">
        <div className="gs-container">

          {/* What Is Scout Section */}
          <section className="gs-section scout-section">
            <div className="section-icon">
              <Target className="w-12 h-12" />
            </div>
            <h2 className="section-title">What Is Scout?</h2>
            <p className="section-description">
              Scout helps you discover who matters. It's where IDYNIFY surfaces the people and companies worth your attention.
            </p>

            <div className="feature-list">
              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Find companies daily</h3>
                  <p className="feature-text">
                    Barry finds companies that match your ICP and adds them to your queue every weekday morning.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Approve or reject in seconds</h3>
                  <p className="feature-text">
                    Swipe through companies in seconds. Fast decisions, no overwhelm.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Select contacts and build your pipeline</h3>
                  <p className="feature-text">
                    Pick the right decision makers from companies you like. That's your pipeline.
                  </p>
                </div>
              </div>
            </div>

            <div className="section-highlight">
              <p>
                <strong>Think of Scout as:</strong> Your daily prospecting habit. A few minutes each morning beats hours of manual research.
              </p>
            </div>

            <button
              className="primary-button"
              onClick={() => navigate('/scout')}
            >
              <Target className="w-5 h-5" />
              <span>Go to Scout</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </section>

          {/* Divider */}
          <div className="section-divider"></div>

          {/* What Is Recon Section */}
          <section className="gs-section recon-section">
            <div className="section-icon">
              <TrendingUp className="w-12 h-12" />
            </div>
            <h2 className="section-title">What Is Recon?</h2>
            <p className="section-description">
              Recon is where you give Barry context. You don't live here — you visit when things change.
            </p>

            <div className="feature-list">
              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Define your ideal customer profile</h3>
                  <p className="feature-text">
                    Answer a few questions about who you sell to, what problems you solve, and who makes buying decisions.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Give Barry the context that matters</h3>
                  <p className="feature-text">
                    The more context you give Barry, the more he has to work with when understanding relationships and helping you communicate.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <CheckCircle className="feature-icon" />
                <div className="feature-content">
                  <h3 className="feature-title">Update when things change</h3>
                  <p className="feature-text">
                    New product launch? Shifting ICP? Come back to Recon and update what Barry knows.
                  </p>
                </div>
              </div>
            </div>

            <div className="section-highlight">
              <p>
                <strong>Think of Recon as:</strong> The context Barry works from. You set the direction, and it shapes everything he writes.
              </p>
            </div>

            <button
              className="secondary-button"
              onClick={() => navigate('/recon')}
            >
              <TrendingUp className="w-5 h-5" />
              <span>Go to Recon</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </section>

          {/* Divider */}
          <div className="section-divider"></div>

          {/* How They Work Together Section */}
          <section className="gs-section together-section">
            <div className="section-icon">
              <Zap className="w-12 h-12" />
            </div>
            <h2 className="section-title">How They Work Together</h2>
            <p className="section-description">
              Recon is where you tell Barry what matters. Scout is where IDYNIFY helps you find who does.
            </p>

            <div className="workflow-diagram">
              <div className="workflow-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h3 className="step-title">Fill out Recon</h3>
                  <p className="step-text">Define your ICP and ideal customer</p>
                </div>
              </div>

              <div className="workflow-arrow">→</div>

              <div className="workflow-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h3 className="step-title">Barry connects the dots</h3>
                  <p className="step-text">Barry connects what you've told him to what he sees</p>
                </div>
              </div>

              <div className="workflow-arrow">→</div>

              <div className="workflow-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <h3 className="step-title">Scout shows you who matters</h3>
                  <p className="step-text">Matches appear in your daily queue</p>
                </div>
              </div>

              <div className="workflow-arrow">→</div>

              <div className="workflow-step">
                <div className="step-number">4</div>
                <div className="step-content">
                  <h3 className="step-title">You take action</h3>
                  <p className="step-text">Review, approve, and build your pipeline</p>
                </div>
              </div>
            </div>

            <div className="improvement-note">
              <Users className="w-6 h-6" />
              <p>
                Your saves shape what Scout looks for next.
              </p>
            </div>
          </section>

          {/* CTA Section */}
          <section className="cta-section">
            <h2 className="cta-title">Ready to Start?</h2>
            <p className="cta-text">
              Head to Scout to review your first companies, or visit Recon to tell Barry about your ideal customer.
            </p>

            <div className="cta-buttons">
              <button
                className="primary-button large"
                onClick={() => navigate('/scout')}
              >
                <Target className="w-6 h-6" />
                <span>Start with Scout</span>
                <ArrowRight className="w-6 h-6" />
              </button>

              <button
                className="secondary-button large"
                onClick={() => navigate('/recon')}
              >
                <TrendingUp className="w-6 h-6" />
                <span>Add context in Recon</span>
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>

            <p className="help-text">
              Questions? Reply to the welcome email from Aaron.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
