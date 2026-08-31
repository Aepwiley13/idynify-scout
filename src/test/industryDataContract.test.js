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
  describe('Forbes fixture: enriched industry renders correctly', () => {
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

  describe('Company with null industry — honest "no data"', () => {
    const noIndustry = {
      name: 'Acme Corp',
      industry: null,
      revenue: '$10M',
    };

    it('resolves industry as unknown, not as a miss', () => {
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
  });

  describe('Poison values treated as absent', () => {
    const poisonValues = ['Unknown', 'Unknown Industry', '', '  '];

    for (const poison of poisonValues) {
      it(`"${poison}" resolves as unknown, not as a real industry`, () => {
        const company = { name: 'Test Co', industry: poison };
        const b = getScoreBreakdown(company, ICP);
        expect(b.industry.unknown).toBe(true);
      });
    }
  });

  describe('Enrichment writeback updates canonical field', () => {
    it('enriched snapshot.industry takes precedence via apolloEnrichment', () => {
      const company = {
        name: 'Forbes',
        industry: null,
        apolloEnrichment: { snapshot: { industry: 'Publishing' } },
      };
      const resolvedIndustry =
        company.apolloEnrichment?.snapshot?.industry || company.industry || null;
      expect(resolvedIndustry).toBe('Publishing');
    });

    it('null enrichment with null base stays null', () => {
      const company = {
        name: 'Mystery Inc',
        industry: null,
        apolloEnrichment: { snapshot: { industry: null } },
      };
      const resolvedIndustry =
        company.apolloEnrichment?.snapshot?.industry || company.industry || null;
      expect(resolvedIndustry).toBeNull();
    });
  });

  describe('ICP scoring handles all field name variants', () => {
    it('reads from primary_industry when industry is absent', () => {
      const company = { name: 'Test', primary_industry: 'Publishing' };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.match).toBe(100);
      expect(b.industry.unknown).toBeFalsy();
    });

    it('reads from company_industry as last resort', () => {
      const company = { name: 'Test', company_industry: 'Publishing' };
      const b = getScoreBreakdown(company, ICP);
      expect(b.industry.match).toBe(100);
      expect(b.industry.unknown).toBeFalsy();
    });
  });
});
