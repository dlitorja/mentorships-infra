# Instructor Images Directory

This directory contains profile pictures and portfolio work for each instructor.

## Folder Structure

Each instructor should have their own folder named using their slug (lowercase, hyphenated):

```
public/instructors/
├── jordan-jardine/
│   ├── profile.jpg (or profile.png)
│   ├── work-1.jpg
│   ├── work-2.jpg
│   └── work-3.jpg
├── cameron-nissen/
│   ├── profile.jpg
│   ├── work-1.jpg
│   └── work-2.jpg
└── ...
```

## Image Requirements

### Profile Images
- **File name**: `profile.jpg` or `profile.png`
- **Recommended size**: 800x800px (square)
- **Format**: JPG or PNG
- **Purpose**: Displayed in instructor cards and profile pages

### Work Images
- **File names**: `work-1.jpg`, `work-2.jpg`, `work-3.jpg`, etc.
- **Recommended size**: 1200x800px (landscape) or 800x1200px (portrait)
- **Format**: JPG or PNG
- **Purpose**: Portfolio showcase on instructor profile pages

## Current Instructors (from mock data)

Based on the mock data, you'll need folders for:

1. `jordan-jardine/`
2. `cameron-nissen/`
3. `nino-vecia/`
4. `oliver-titley/`
5. `malina-dowling/`
6. `rakasa/`
7. `amanda-kiefer/`
8. `neil-gray/`
9. `ash-kirk/`
10. `andrea-sipl/`

## Adding New Instructors

When adding a new instructor:

1. Create a folder with their slug (e.g., `new-instructor/`)
2. Add `profile.jpg` or `profile.png`
3. Add work images as `work-1.jpg`, `work-2.jpg`, etc.
4. Update the mock data in `lib/instructors.ts` (or database when ready)

## Image Optimization

Next.js Image component will automatically optimize these images. However, for best performance:

- Keep file sizes reasonable (< 500KB per image)
- Use appropriate formats (JPG for photos, PNG for graphics with transparency)
- Consider using WebP format for better compression (Next.js will serve WebP when supported)

