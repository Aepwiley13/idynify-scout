# Social Preview Image - Setup Required

## ⚠️ Action Needed

The social preview meta tags have been added to `index.html`, but the actual preview image needs to be created.

## Quick Start

1. **View the design template**: Open `/public/social-preview-template.html` in a browser to see the layout
2. **Read the specs**: Review `/public/SOCIAL-PREVIEW-SPECS.md` for detailed requirements
3. **Create the image**: Use Figma, Canva, Photoshop, or similar tool
4. **Save as**: `/public/social-preview.png` (1200×630px)
5. **Test it**: Use the validation tools listed in the specs

## What's Already Done

✅ Open Graph meta tags added to `index.html`
✅ Twitter Card meta tags added to `index.html`
✅ Design specifications documented
✅ Visual template created for reference

## What's Needed

🎨 **Create the actual image file:**
- Filename: `social-preview.png`
- Location: `/public/social-preview.png`
- Size: 1200 × 630 pixels
- Content: Barry the Bear + "Find your ideal clients in minutes" + "It's like Tinder for your ICP"

## Current Meta Tags

The following meta tags are now live in `index.html`:

```html
<!-- Open Graph / Facebook -->
<meta property="og:title" content="Find your ideal clients in minutes" />
<meta property="og:description" content="It's like Tinder for your ICP" />
<meta property="og:image" content="https://idynify-scout.netlify.app/social-preview.png" />

<!-- Twitter -->
<meta property="twitter:card" content="summary_large_image" />
<meta property="twitter:title" content="Find your ideal clients in minutes" />
<meta property="twitter:description" content="It's like Tinder for your ICP" />
<meta property="twitter:image" content="https://idynify-scout.netlify.app/social-preview.png" />
```

## Testing After Creation

Once you've created and uploaded `social-preview.png`, test it using:

- **Facebook**: https://developers.facebook.com/tools/debug/
- **Twitter**: https://cards-dev.twitter.com/validator
- **LinkedIn**: https://www.linkedin.com/post-inspector/

## Need Help?

- Visual reference: `/public/social-preview-template.html`
- Design specs: `/public/SOCIAL-PREVIEW-SPECS.md`
- Contact design team to create the final image

---

**Pro Tip**: The preview image is cached by social platforms. After uploading a new version, use the validation tools above to clear the cache.
