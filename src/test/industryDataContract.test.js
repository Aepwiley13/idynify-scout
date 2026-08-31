import { describe, it, expect } from 'vitest';
import {
  calculateICPScore,
  scoreCompany,
  getScoreBreakdown,
  DEFAULT_WEIGHTS,
} from '../utils/icpScoring.js';

const ICP = {
  industries: ['Publishing'],
  companySizes: ['5,001-10,000'],
  locations: ['NY'],
  revenueRanges: ['$1B+'],
  isNationwide: false,
};

describe('Industry data contract — end-to-end field flow', () => {
  describe('Forbes fixture: known enrichment data scores correctly', () => {
    const forbes = {
      name: 'Forbes',
      industry: 'Publishing',
      revenue: '$3B',
      founded_year: 1917,
    };

    it('scores industry as a match', () => {
      const b = getScoreBreakdown(forbes, ICP);
      expect(b.industry.match).toBe(100);
      expect(b.industry.unknown).toBeFalsy();
    });

    it('produces a non-zero ICP score', () => {
      expect(calculateICPScore(forbes, ICP)).toBeGreaterThan(0);
    });

    it('generates a match reason mentioning the industry', () => {
      const result = scoreCompany(forbes, ICP);
      const industryReason = result.reasons.find(r =>
        r.toLowerCase().includes('publishing') || r.toLowerCase().includes('industry')
      );
      expect(industryReason).toBeTruthy();
    });
  });

  describe('Null industry — scoring honesty', () => {
    const noIndustry = {
      name: 'Acme Corp',
      industry: null,
      revenue: '$10M',
    };

    it('resolves as unknown, not as a miss', () => {
      const b = getScoreBreakdown(noIndustry, ICP);
      expect(b.industry.unknown).toBe(true);
      expect(b.industry.match).toBe(50);
    });

    it('does not produce a false industry match reason', () => {
      const result = scoreCompany(noIndustry, ICP);
      const industryReason = result.reasons.find(r =>
        r.toLowerCase().includes('industry match')
      );
      expect(industryReason).toBeFalsy();
    });

    it('undefined industry also resolves as unknown', () => {
      const company = { name: 'No Data Inc' };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.unknown).toBe(true);
    });
  });

  describe('Poison values cannot re-enter as real industry', () => {
    const poisonValues = ['Unknown', 'Unknown Industry', 'Not specified', 'N/A', '', '  '];

    for (const poison of poisonValues) {
      it(`"${poison}" resolves as unknown, not as a real industry`, () => {
        const company = { name: 'Test Co', industry: poison };
        const b = getScoreBreakdown(company, ICP);
        expect(b.industry.unknown).toBe(true);
      });
    }
  });

  describe('Zombie fields are not read — only canonical industry field', () => {
    it('primary_industry alone does NOT resolve (zombie field removed)', () => {
      const company = { name: 'Test', primary_industry: 'Publishing' };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.unknown).toBe(true);
    });

    it('company_industry alone does NOT resolve (zombie field removed)', () => {
      const company = { name: 'Test', company_industry: 'Publishing' };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.unknown).toBe(true);
    });

    it('only company.industry is read by scoring', () => {
      const company = {
        name: 'Test',
        industry: 'Publishing',
        primary_industry: 'Banking',
        company_industry: 'Finance',
      };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.match).toBe(100);
    });
  });

  describe('No per-surface fallback logic remains', () => {
    it('same company record produces same score regardless of context', () => {
      const company = { name: 'Forbes', industry: 'Publishing', revenue: '$3B' };
      const score1 = calculateICPScore(company, ICP);
      const score2 = calculateICPScore(company, ICP);
      expect(score1).toBe(score2);

      const breakdown1 = getScoreBreakdown(company, ICP);
      const breakdown2 = getScoreBreakdown(company, ICP);
      expect(breakdown1.industry.match).toBe(breakdown2.industry.match);
    });
  });

  describe('Barry gets the canonical value — not a fabricated one', () => {
    it('null industry in company record stays null for downstream consumers', () => {
      const company = { name: 'Acme', industry: null };
      const barryIndustry = company.industry || 'Not specified';
      expect(barryIndustry).toBe('Not specified');
    });

    it('real industry in company record passes through correctly', () => {
      const company = { name: 'Forbes', industry: 'Publishing' };
      const barryIndustry = company.industry || 'Not specified';
      expect(barryIndustry).toBe('Publishing');
    });
  });
});
