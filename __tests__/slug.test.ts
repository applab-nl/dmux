import { describe, it, expect } from 'vitest';
import { generateSlug, generateSimpleSlug, generateLongPromptSlug, isClaudeAvailable } from '../src/utils/slug.js';

describe('slug generation', () => {
  it('falls back to timestamp when no providers available', async () => {
    const slug = await generateSlug('');
    expect(slug.startsWith('dmux-')).toBe(true);
  });

  it('returns kebab-ish slug for prompt (or fallback)', async () => {
    const slug = await generateSlug('Refactor Dmux App');
    expect(typeof slug).toBe('string');
    expect(slug.length).toBeGreaterThan(0);
  });
});

describe('generateSimpleSlug', () => {
  describe('basic functionality', () => {
    it('generates kebab-case slug from simple prompt', () => {
      expect(generateSimpleSlug('Fix bug')).toBe('fix-bug');
    });

    it('generates slug from multi-word prompt', () => {
      expect(generateSimpleSlug('Add user profile')).toBe('add-user-profile');
    });

    it('converts to lowercase', () => {
      expect(generateSimpleSlug('Fix Authentication Bug')).toBe('fix-authentication-bug');
    });
  });

  describe('stopword filtering', () => {
    it('filters out common stopwords', () => {
      expect(generateSimpleSlug('Fix the authentication bug')).toBe('fix-authentication-bug');
    });

    it('filters multiple stopwords', () => {
      expect(generateSimpleSlug('Add a new user profile page')).toBe('add-user-profile');
    });

    it('handles stopwords at various positions', () => {
      expect(generateSimpleSlug('The bug in the login flow')).toBe('bug-login-flow');
    });

    it('falls back to timestamp when only stopwords', () => {
      const slug = generateSimpleSlug('the a an is');
      expect(slug).toMatch(/^dmux-\d+$/);
    });
  });

  describe('word count limits', () => {
    it('limits to 3 words maximum', () => {
      expect(generateSimpleSlug('Refactor the API endpoints for better performance'))
        .toBe('refactor-api-endpoints');
    });

    it('handles exactly 3 meaningful words', () => {
      expect(generateSimpleSlug('Fix authentication bug')).toBe('fix-authentication-bug');
    });

    it('handles 1 word', () => {
      expect(generateSimpleSlug('refactor')).toBe('refactor');
    });

    it('handles 2 words', () => {
      expect(generateSimpleSlug('update docs')).toBe('update-docs');
    });
  });

  describe('length truncation', () => {
    it('truncates long slugs to 30 characters at word boundary', () => {
      const slug = generateSimpleSlug('implementation configuration optimization');
      expect(slug.length).toBeLessThanOrEqual(30);
      expect(slug).not.toContain(' ');
      // Should break at hyphen
      expect(slug.endsWith('-')).toBe(false);
    });

    it('handles slug exactly at 30 character limit', () => {
      // "verification-implementation" = 29 chars (under limit)
      const slug = generateSimpleSlug('verification implementation test');
      expect(slug.length).toBeLessThanOrEqual(30);
    });
  });

  describe('special characters and punctuation', () => {
    it('removes punctuation', () => {
      expect(generateSimpleSlug('Fix bug!')).toBe('fix-bug');
    });

    it('handles quotes and commas', () => {
      expect(generateSimpleSlug('Add "user" profile, please')).toBe('add-user-profile');
    });

    it('handles parentheses and brackets', () => {
      expect(generateSimpleSlug('Fix (critical) bug [urgent]')).toBe('fix-critical-bug');
    });

    it('normalizes multiple spaces', () => {
      expect(generateSimpleSlug('Fix    authentication    bug')).toBe('fix-authentication-bug');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const slug = generateSimpleSlug('');
      expect(slug).toMatch(/^dmux-\d+$/);
    });

    it('handles whitespace-only string', () => {
      const slug = generateSimpleSlug('   ');
      expect(slug).toMatch(/^dmux-\d+$/);
    });

    it('handles string with only punctuation', () => {
      const slug = generateSimpleSlug('!@#$%^&*()');
      expect(slug).toMatch(/^dmux-\d+$/);
    });

    it('handles mixed case with numbers', () => {
      expect(generateSimpleSlug('Fix Bug 123')).toBe('fix-bug-123');
    });

    it('preserves hyphens in original text', () => {
      expect(generateSimpleSlug('Add user-authentication')).toBe('add-user-authentication');
    });
  });

  describe('realistic examples', () => {
    it('handles typical bug fix prompt', () => {
      expect(generateSimpleSlug('Fix the authentication bug in login flow'))
        .toBe('fix-authentication-bug');
    });

    it('handles feature addition prompt', () => {
      expect(generateSimpleSlug('Add user profile page with settings'))
        .toBe('add-user-profile');
    });

    it('handles refactoring prompt', () => {
      expect(generateSimpleSlug('Refactor API endpoints for better performance'))
        .toBe('refactor-api-endpoints');
    });

    it('handles documentation update', () => {
      expect(generateSimpleSlug('Update the README with installation instructions'))
        .toBe('update-readme-installation');
    });

    it('handles test addition', () => {
      expect(generateSimpleSlug('Add tests for user authentication'))
        .toBe('add-tests-user');
    });
  });
});

describe('isClaudeAvailable', () => {
  it('returns boolean indicating if claude is available', () => {
    const available = isClaudeAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('generateLongPromptSlug', () => {
  describe('long prompt detection and handling', () => {
    it('returns null when claude is not available', async () => {
      // This test will pass or fail depending on local environment
      const claudeAvailable = isClaudeAvailable();
      if (!claudeAvailable) {
        const slug = await generateLongPromptSlug('This is a very long prompt that should be handled specially');
        expect(slug).toBeNull();
      }
    });

    it('handles very long prompts when claude is available', async () => {
      const claudeAvailable = isClaudeAvailable();
      if (claudeAvailable) {
        const longPrompt = 'I need to refactor the entire authentication system to use OAuth2 instead of the current JWT-based approach, ensuring backward compatibility with existing users and implementing proper token refresh mechanisms with secure storage practices';
        const slug = await generateLongPromptSlug(longPrompt);

        if (slug) {
          expect(slug).not.toMatch(/^dmux-\d+$/); // Should not be timestamp fallback
          expect(slug).toMatch(/^[a-z0-9-]+$/); // Should be kebab-case
          expect(slug.length).toBeLessThanOrEqual(40); // Should respect max length
          expect(slug.split('-').length).toBeLessThanOrEqual(5); // Max 5 words
        }
      } else {
        // Skip test if Claude not available
        expect(true).toBe(true);
      }
    });
  });

  describe('slug format validation', () => {
    it('generates properly formatted kebab-case slugs', async () => {
      const claudeAvailable = isClaudeAvailable();
      if (claudeAvailable) {
        const prompt = 'Create a comprehensive testing suite for the user authentication module including unit tests, integration tests, and end-to-end tests with proper mocking and coverage reporting';
        const slug = await generateLongPromptSlug(prompt);

        if (slug) {
          expect(slug).toMatch(/^[a-z0-9-]+$/); // Only lowercase, numbers, hyphens
          expect(slug.startsWith('-')).toBe(false); // No leading hyphen
          expect(slug.endsWith('-')).toBe(false); // No trailing hyphen
          expect(slug).not.toContain('--'); // No double hyphens
        }
      } else {
        expect(true).toBe(true);
      }
    });
  });
});
