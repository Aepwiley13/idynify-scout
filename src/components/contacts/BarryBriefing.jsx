import './BarryBriefing.css';

export default function BarryBriefing({ barryContext, contact }) {
  // If no Barry context available yet, show loading state
  if (!barryContext) {
    return (
      <div className="barry-briefing">
        <div className="briefing-loading">
          <div className="loading-shimmer"></div>
          <div className="loading-shimmer"></div>
          <div className="loading-shimmer"></div>
        </div>
      </div>
    );
  }

  // Generate prose briefing from Barry's structured context
  // Converts Barry's sections into 2-4 natural language statements
  const generateBriefing = () => {
    const statements = [];

    // Statement 1: Who you're meeting (always included)
    if (barryContext.whoYoureMeeting) {
      statements.push(barryContext.whoYoureMeeting);
    }

    // Statement 2: Role insights (first 2 bullets as prose)
    if (barryContext.whatRoleCaresAbout && barryContext.whatRoleCaresAbout.length > 0) {
      const roleBullets = barryContext.whatRoleCaresAbout.slice(0, 2);
      const roleStatement = roleBullets.join('. ') + '.';
      statements.push(roleStatement);
    }

    // Statement 3: Company context (first 1-2 bullets as prose)
    if (barryContext.whatCompanyFocusedOn && barryContext.whatCompanyFocusedOn.length > 0) {
      const companyBullets = barryContext.whatCompanyFocusedOn.slice(0, 2);
      const companyStatement = companyBullets.join('. ') + '.';
      statements.push(companyStatement);
    }

    // Statement 4: Calm reframe (if under word limit)
    if (barryContext.calmReframe && statements.join(' ').split(' ').length < 90) {
      statements.push(barryContext.calmReframe);
    }

    // Return only 2-4 statements (enforce spec)
    return statements.slice(0, 4);
  };

  const briefingStatements = generateBriefing();

  return (
    <div className="barry-briefing">
      <div className="briefing-content">
        {briefingStatements.map((statement, index) => (
          <p key={index} className="briefing-statement">
            {statement}
          </p>
        ))}
      </div>
    </div>
  );
}
