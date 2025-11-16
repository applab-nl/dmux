import { execSync } from 'child_process';

/**
 * Generates a simple slug from a prompt using text processing (no AI).
 * Filters out common stopwords and creates kebab-case slug.
 * Falls back to timestamp if no meaningful words remain.
 */
export const generateSimpleSlug = (prompt: string): string => {
  if (!prompt || !prompt.trim()) {
    return `dmux-${Date.now()}`;
  }

  // Common stopwords to filter out
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'can', 'this', 'that',
    'these', 'those', 'it', 'its', 'new', 'page', 'please', 'just', 'into',
    'than', 'them', 'then', 'now', 'only', 'some', 'all', 'my', 'your',
    'our', 'their'
  ]);

  // Convert to lowercase, remove punctuation, split into words
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .split(' ')
    .filter(word => word.length > 0 && !stopwords.has(word));

  // If no meaningful words remain, use timestamp fallback
  if (words.length === 0) {
    return `dmux-${Date.now()}`;
  }

  // Take first 3 words, join with hyphens
  const slug = words.slice(0, 3).join('-');

  // Truncate to max 30 characters (find last hyphen if needed)
  const MAX_LENGTH = 30;
  if (slug.length > MAX_LENGTH) {
    const truncated = slug.substring(0, MAX_LENGTH);
    const lastHyphen = truncated.lastIndexOf('-');
    return lastHyphen > 0 ? truncated.substring(0, lastHyphen) : truncated;
  }

  return slug;
};

/**
 * Calls Claude Code CLI with a prompt and returns the response.
 * @param prompt - The prompt to send to Claude
 * @param maxWords - Optional max word count for the response (default: no limit)
 */
export const callClaudeCode = async (prompt: string, maxWords?: number): Promise<string | null> => {
  try {
    const result = execSync(
      `echo "${prompt.replace(/"/g, '\\"')}" | claude --no-interactive --max-turns 1 2>/dev/null | head -n 5`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }
    );
    const lines = result.trim().split('\n');
    let response = lines.join(' ').trim();

    // If maxWords specified, truncate to word count
    if (maxWords && response) {
      const words = response.split(/\s+/);
      if (words.length > maxWords) {
        response = words.slice(0, maxWords).join('-');
      }
    }

    return response || null;
  } catch {
    return null;
  }
};

/**
 * Checks if Claude CLI is available on the system.
 */
export const isClaudeAvailable = (): boolean => {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Generates a slug for long prompts using Claude CLI with a meta-prompt.
 * Returns a 3-5 word kebab-case slug that captures the intent.
 */
export const generateLongPromptSlug = async (prompt: string): Promise<string | null> => {
  if (!isClaudeAvailable()) {
    return null;
  }

  const metaPrompt = `Analyze this task description and create a concise 3-5 word kebab-case slug that captures its core intent. Only respond with the slug, nothing else. No explanations.

Task: "${prompt}"

Slug:`;

  try {
    const response = await callClaudeCode(metaPrompt);
    if (response) {
      // Clean up the response: lowercase, remove non-alphanumeric except hyphens, limit to 5 words
      const slug = response
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .split('-')
        .filter(word => word.length > 0)
        .slice(0, 5)
        .join('-');

      // Ensure it's not too long
      const MAX_LENGTH = 40;
      if (slug.length > MAX_LENGTH) {
        const truncated = slug.substring(0, MAX_LENGTH);
        const lastHyphen = truncated.lastIndexOf('-');
        return lastHyphen > 0 ? truncated.substring(0, lastHyphen) : truncated;
      }

      return slug || null;
    }
  } catch {
    return null;
  }

  return null;
};

export const generateSlug = async (prompt: string): Promise<string> => {
  if (!prompt) return `dmux-${Date.now()}`;

  // Detect if prompt is long (more than 100 characters or 15 words)
  const wordCount = prompt.split(/\s+/).length;
  const isLongPrompt = prompt.length > 100 || wordCount > 15;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    // Try multiple models with fallback
    const models = ['google/gemini-2.5-flash', 'x-ai/grok-4-fast:free', 'openai/gpt-4o-mini'];

    for (const model of models) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: `Generate a 1-2 word kebab-case slug for this prompt. Only respond with the slug, nothing else: "${prompt}"`
              }
            ],
            max_tokens: 10,
            temperature: 0.3
          })
        });

        if (response.ok) {
          const data = await response.json() as any;
          const slug = data.choices[0].message.content.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
          if (slug) return slug;
        }
      } catch {
        // Try next model
        continue;
      }
    }
  }

  // For long prompts, use Claude CLI with meta-prompt if available
  if (isLongPrompt) {
    const longPromptSlug = await generateLongPromptSlug(prompt);
    if (longPromptSlug) {
      return longPromptSlug;
    }
  }

  // For short prompts or if long prompt slug generation failed, try basic Claude CLI
  const claudeResponse = await callClaudeCode(
    `Generate a 1-2 word kebab-case slug for this prompt. Only respond with the slug, nothing else: "${prompt}"`
  );
  if (claudeResponse) {
    const slug = claudeResponse.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (slug) return slug;
  }

  // Try simple text-based slug generation
  const simpleSlug = generateSimpleSlug(prompt);
  if (simpleSlug && !simpleSlug.startsWith('dmux-')) {
    return simpleSlug;
  }

  // Final fallback to timestamp
  return `dmux-${Date.now()}`;
};
