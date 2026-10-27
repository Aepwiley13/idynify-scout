/**
 * Social profiles: the platform registry, the reader and the additive merge
 * (src/utils/socialProfiles.js). Every handle here is fictional.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSocialReference, makeSocialProfile, readSocialProfiles, mergeSocialProfiles, socialKey,
  SOCIAL_PLATFORMS, REVIEW_SOCIAL_PLATFORMS, SOCIAL_STATUS, SOCIAL_SOURCES,
} from '../utils/socialProfiles';

const AT = '2026-10-27T22:00:00.000Z';
const card = (text, platform = null) => makeSocialProfile({
  text, platform, source: SOCIAL_SOURCES.BUSINESS_CARD, status: SOCIAL_STATUS.OBSERVED, addedAt: AT,
});
const confirmed = (text, platform = null) => makeSocialProfile({
  text, platform, source: SOCIAL_SOURCES.USER, status: SOCIAL_STATUS.USER_CONFIRMED, addedAt: AT,
});

describe('the registry', () => {
  it('knows LinkedIn, Instagram and Facebook; review offers Instagram and Facebook (LinkedIn has its own field)', () => {
    expect(SOCIAL_PLATFORMS).toEqual(['linkedin', 'instagram', 'facebook']);
    expect(REVIEW_SOCIAL_PLATFORMS).toEqual(['instagram', 'facebook']);
  });

  it('has no X yet: an existing twitter_url is left alone and not shown', () => {
    expect(parseSocialReference('https://x.com/kristin')).toBeNull();
    expect(readSocialProfiles({ twitter_url: 'https://twitter.com/kristin' })).toEqual([]);
  });
});

describe('parseSocialReference', () => {
  it('a bare handle has no platform unless one is given: the network is never guessed', () => {
    expect(parseSocialReference('@KRISTINSOKOL')).toEqual({ platform: null, handle: 'kristinsokol', url: null });
    expect(parseSocialReference('@KRISTINSOKOL', { platform: 'instagram' }))
      .toEqual({ platform: 'instagram', handle: 'kristinsokol', url: 'https://www.instagram.com/kristinsokol' });
  });

  it('an address names its platform, whatever platform is given', () => {
    expect(parseSocialReference('instagram.com/KristinSokol/', { platform: 'facebook' }))
      .toEqual({ platform: 'instagram', handle: 'kristinsokol', url: 'https://www.instagram.com/kristinsokol' });
    expect(parseSocialReference('https://m.facebook.com/kristin.sokol?ref=card'))
      .toEqual({ platform: 'facebook', handle: 'kristin.sokol', url: 'https://www.facebook.com/kristin.sokol' });
    expect(parseSocialReference('facebook.com/profile.php?id=100012345'))
      .toEqual({ platform: 'facebook', handle: 'profile.php?id=100012345', url: 'https://www.facebook.com/profile.php?id=100012345' });
  });

  it('a handle with a dot is a handle, not a website', () => {
    expect(parseSocialReference('kristin.sokol')).toEqual({ platform: null, handle: 'kristin.sokol', url: null });
  });

  it('refuses what is not a profile: another site, a post, words, a handle the platform cannot have', () => {
    expect(parseSocialReference('www.acme.com')).toBeNull();
    expect(parseSocialReference('https://acme.com/kristin')).toBeNull();
    expect(parseSocialReference('instagram.com/p/C0abc')).toBeNull();
    expect(parseSocialReference('instagram.com')).toBeNull();
    expect(parseSocialReference('Kristin Sokol')).toBeNull();
    expect(parseSocialReference('@kristin-sokol', { platform: 'instagram' })).toBeNull();
    expect(parseSocialReference('')).toBeNull();
    expect(parseSocialReference(null)).toBeNull();
  });
});

describe('makeSocialProfile', () => {
  it('keeps the printed text, its source and its trust', () => {
    expect(card('@KRISTINSOKOL', 'instagram')).toEqual({
      platform: 'instagram', handle: 'kristinsokol', url: 'https://www.instagram.com/kristinsokol',
      observed: '@KRISTINSOKOL', source: 'business_card', status: 'observed', added_at: AT,
    });
  });

  it('is nothing without a platform', () => {
    expect(card('@KRISTINSOKOL')).toBeNull();
  });
});

describe('readSocialProfiles', () => {
  it('reads the list and the older single fields, without repeating a profile, in platform order', () => {
    const contact = {
      linkedin_url: 'https://www.linkedin.com/in/kristin-sokol',
      facebook_url: 'facebook.com/Kristin.Sokol',
      social_profiles: [card('facebook.com/kristin.sokol'), card('@KRISTINSOKOL', 'instagram')],
    };
    expect(readSocialProfiles(contact).map(p => [p.platform, p.handle, p.source])).toEqual([
      ['linkedin', 'kristin-sokol', 'contact_field'],
      ['instagram', 'kristinsokol', 'business_card'],
      ['facebook', 'kristin.sokol', 'business_card'],
    ]);
  });

  it('skips stored entries it cannot read, and reads a contact with nothing as nothing', () => {
    expect(readSocialProfiles({ social_profiles: [{ platform: 'tiktok', handle: 'k' }, null, 'x', { platform: 'instagram' }] })).toEqual([]);
    expect(readSocialProfiles({})).toEqual([]);
    expect(readSocialProfiles(null)).toEqual([]);
  });
});

describe('mergeSocialProfiles', () => {
  const OWN = {
    social_profiles: [
      { ...card('@kristinsokol', 'instagram'), status: SOCIAL_STATUS.USER_CONFIRMED },
      { platform: 'tiktok', handle: 'kristin', note: 'from a later version' },
    ],
  };

  it('adds only profiles the contact does not have, comparing their matching form', () => {
    const { patch, added } = mergeSocialProfiles(OWN, [
      card('instagram.com/KristinSokol'),              // the same profile, written differently
      card('@studio.sokol', 'instagram'),             // another Instagram: added beside, never instead
      card('facebook.com/kristin.sokol'),
    ]);
    expect(added.map(socialKey)).toEqual(['instagram:studio.sokol', 'facebook:kristin.sokol']);
    expect(patch.social_profiles.map(p => p.handle)).toEqual(['kristinsokol', 'kristin', 'studio.sokol', 'kristin.sokol']);
  });

  it('keeps every existing entry exactly as stored, its status and entries it does not understand included', () => {
    const { patch } = mergeSocialProfiles(OWN, [card('@studio.sokol', 'instagram')]);
    expect(patch.social_profiles.slice(0, 2)).toEqual(OWN.social_profiles);
  });

  it('a profile already in an older single field is not added again', () => {
    expect(mergeSocialProfiles({ facebook_url: 'https://www.facebook.com/kristin.sokol' }, [card('facebook.com/Kristin.Sokol')]))
      .toEqual({ patch: {}, added: [] });
  });

  it('never adds LinkedIn: linkedin_url is its record', () => {
    expect(mergeSocialProfiles({}, [confirmed('linkedin.com/in/kristin')])).toEqual({ patch: {}, added: [] });
  });

  it('only a confirmed profile fills an empty older field, and never replaces one', () => {
    expect(mergeSocialProfiles({}, [card('facebook.com/kristin.sokol')]).patch).not.toHaveProperty('facebook_url');
    expect(mergeSocialProfiles({}, [confirmed('facebook.com/kristin.sokol')]).patch.facebook_url).toBe('https://www.facebook.com/kristin.sokol');
    expect(mergeSocialProfiles({ facebook_url: 'https://www.facebook.com/someone.else' }, [confirmed('facebook.com/kristin.sokol')]).patch)
      .not.toHaveProperty('facebook_url');
  });

  it('adds nothing twice, and running it again on the result adds nothing', () => {
    const incoming = [card('@kristinsokol', 'instagram'), card('instagram.com/kristinsokol')];
    const once = mergeSocialProfiles({}, incoming);
    expect(once.added).toHaveLength(1);
    expect(mergeSocialProfiles(once.patch, incoming)).toEqual({ patch: {}, added: [] });
  });
});
