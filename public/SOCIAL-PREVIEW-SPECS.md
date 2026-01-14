# Social Preview Image Specifications

## Image Requirements
- **Filename**: `social-preview.png` (place in `/public` folder)
- **Dimensions**: 1200 × 630 pixels (required for Open Graph)
- **Format**: PNG or JPG
- **Optimization**: Compress for web (aim for < 1MB)

## Design Layout

### Background
- Use primary brand gradient: Black background with cyan (#06B6D4) and purple (#8B5CF6) glow effects
- Starfield effect (subtle, not distracting)
- Keep Barry the focal point - background should not compete

### Main Visual: Barry the Bear 🐻
- **Position**: Center-left (approximately 30-40% from left edge)
- **Size**: Large and prominent (approximately 400-500px height)
- **Expression**: Friendly, confident, slightly playful
- **Style**: Use the bear emoji at very large size OR custom illustration
- **No background circle** - Barry should appear clean without shapes behind him

### Text Layout

#### Headline (Primary Text)
- **Content**: "Find your ideal clients in minutes"
- **Position**: Right side of Barry (60-70% from left)
- **Font**: Bold, modern sans-serif (similar to your app font)
- **Size**: 72-84px
- **Color**: White (#FFFFFF)
- **Effect**: Subtle cyan glow/shadow for pop

#### Subheadline (Secondary Text)
- **Content**: "It's like Tinder for your ICP"
- **Position**: Directly below headline
- **Font**: Same family as headline, but regular weight
- **Size**: 42-52px
- **Color**: Cyan (#06B6D4) or light gray (#E5E7EB)

### Brand Elements
- Small star ⭐ decoration near Barry (like in the app)
- Optional: "idynify Scout" logo/wordmark in bottom corner (small, subtle)

## Color Palette (Brand Colors Only)
- **Black**: #000000 (background base)
- **Cyan**: #06B6D4 (accent, subheadline)
- **Purple**: #8B5CF6 (accent, glow effects)
- **White**: #FFFFFF (headline)
- **Gray tones**: #E5E7EB, #9CA3AF (supporting text)

## Typography Hierarchy
1. **Headline**: Bold, large, high contrast
2. **Subheadline**: Smaller, secondary color
3. **Keep it to 2 lines maximum**

## Design Principles
✅ **DO:**
- Make Barry large and visually dominant
- Use high contrast for readability
- Keep text minimal (2 lines max)
- Balance Barry and text
- Use brand colors consistently
- Optimize for mobile preview (many users will see this on phones)

❌ **DON'T:**
- Add animations or GIFs
- Use UI screenshots
- Clutter with multiple messages
- Add too much text
- Use colors outside brand palette
- Make Barry too small or hide him

## Testing Checklist

Before finalizing, test the image at:
1. **Facebook Sharing Debugger**: https://developers.facebook.com/tools/debug/
2. **Twitter Card Validator**: https://cards-dev.twitter.com/validator
3. **LinkedIn Post Inspector**: https://www.linkedin.com/post-inspector/
4. **iMessage**: Paste link into Messages app on iPhone
5. **Slack**: Paste link into a channel

## Example Layout (ASCII mockup)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│     🐻⭐            Find your ideal clients            │
│                           in minutes                    │
│                                                         │
│                     It's like Tinder for your ICP      │
│                                                         │
│                                          idynify Scout  │
└─────────────────────────────────────────────────────────┘
     Large Bear         Bold Headline      Small Branding
     Center-Left        Right Side         Bottom Right
```

## Next Steps

1. Create the image using design software (Figma, Canva, Photoshop, etc.)
2. Export as PNG at 1200×630px
3. Compress for web (use TinyPNG or similar)
4. Save as `/public/social-preview.png`
5. Test with validation tools above
6. Deploy and verify on production URL

---

**File Path**: `/public/social-preview.png`
**Referenced in**: `/index.html` (Open Graph and Twitter Card meta tags)
