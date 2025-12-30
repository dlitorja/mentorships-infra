# Team Guide: Working with the Mentorship Platform Monorepo

This guide will help you get started with making changes to the marketing website and submitting your work for review.

## Table of Contents

1. [Cloning the Repository](#cloning-the-repository)
2. [Important: Marketing Website Changes Only](#important-marketing-website-changes-only)
3. [Making Changes to Instructor Profiles](#making-changes-to-instructor-profiles)
4. [Changing Homepage Copy](#changing-homepage-copy)
5. [Submitting Pull Requests](#submitting-pull-requests)

---

## Cloning the Repository

To get started, clone the repository to your local machine:

```bash
git clone git@github.com:dlitorja/mentorships-infra.git
cd mentorships-infra
```

### Initial Setup

After cloning, you'll need to install dependencies. This project uses `pnpm` as the package manager:

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Install all dependencies
pnpm install
```

**Note**: You don't need to run the development server or set up environment variables if you're only making content changes to the marketing website. You can make your changes and submit a pull request.

---

## Important: Marketing Website Changes Only

⚠️ **CRITICAL**: If you're making changes to the marketing website, **ONLY edit files within the `apps/marketing` directory**.

### What You Should Edit

✅ **DO edit files in:**
- `apps/marketing/` - This is the marketing website directory
- `apps/marketing/app/page.tsx` - Homepage content
- `apps/marketing/lib/instructors.ts` - Instructor data (bios, taglines, etc.)
- `apps/marketing/public/instructors/` - Instructor images

### What You Should NOT Edit

❌ **DON'T edit files in:**
- `apps/web/` - This is the main application (not the marketing site)
- `packages/` - These are shared packages used by the application
- `scripts/` - Build and deployment scripts
- Any configuration files in the root directory (unless specifically asked)

---

## Making Changes to Instructor Profiles

Instructor profiles include their bio, tagline, and profile images. Here's how to update them:

### Updating Instructor Bio and Tagline

1. Open the file: `apps/marketing/lib/instructors.ts`

2. Find the instructor you want to update by searching for their name or slug (e.g., `"jordan-jardine"`)

3. Update the following fields:
   - `tagline` - Short professional tagline (appears on instructor cards)
   - `bio` - Full bio description (appears on instructor profile page)

**Example:**

```typescript
{
  id: "jordan-jardine",
  name: "Jordan Jardine",
  slug: "jordan-jardine",
  tagline: "Your updated tagline here",
  bio: "Your updated bio text here. This can be multiple sentences...",
  // ... rest of the instructor data
}
```

### Updating Instructor Profile Images

Instructor images are stored in the `apps/marketing/public/instructors/` directory.

#### Profile Image

1. Navigate to the instructor's folder: `apps/marketing/public/instructors/[instructor-slug]/`
   - For example: `apps/marketing/public/instructors/jordan-jardine/`

2. Replace the existing `profile.jpg` or `profile.png` file with your new image
   - **File name must be**: `profile.jpg` or `profile.png`
   - **Recommended size**: 800x800px (square)
   - **Format**: JPG or PNG

#### Portfolio/Work Images

1. In the same instructor folder, you can update portfolio images
   - **File names**: `work-1.jpg`, `work-2.jpg`, `work-3.jpg`, etc.
   - **Recommended size**: 1200x800px (landscape) or 800x1200px (portrait)
   - **Format**: JPG or PNG

2. After adding/removing work images, update the `workImages` array in `apps/marketing/lib/instructors.ts`:

```typescript
{
  // ... other instructor data
  workImages: [
    "/instructors/jordan-jardine/work-1.jpg",
    "/instructors/jordan-jardine/work-2.jpg",
    "/instructors/jordan-jardine/work-3.jpg",
  ],
}
```

**Important Notes:**
- Keep image file sizes reasonable (< 500KB per image)
- Use JPG for photos, PNG for graphics with transparency
- The file paths in `workImages` must match the actual file names in the folder

---

## Changing Homepage Copy

The homepage content is located in `apps/marketing/app/page.tsx`.

### Main Sections You Can Edit

1. **Hero Section** (lines ~14-36)
   - Main title: "Huckleberry Art Mentorships"
   - Subtitle: "Personalized mentorship experiences with world-class instructors."
   - Description paragraph
   - Button text

2. **Featured Instructors Section** (lines ~38-61)
   - Section title: "Our Instructors"
   - Description text
   - Button text

3. **How It Works Section** (lines ~63-93)
   - Section title: "How it works"
   - Step descriptions (Step 1, Step 2, Step 3)

4. **Testimonials Section** (lines ~95-112)
   - Section title: "What students say"
   - Description text

5. **Call-to-Action Section** (lines ~114-129)
   - Section title: "Ready to get started?"
   - Description text
   - Button text

### How to Edit

1. Open `apps/marketing/app/page.tsx`

2. Find the section you want to change (use the line numbers above as a guide)

3. Update the text content within the JSX elements

**Example - Changing the Hero Title:**

```tsx
// Before
<h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
  Huckleberry Art Mentorships
</h1>

// After
<h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
  Your New Title Here
</h1>
```

**Important Notes:**
- Don't change the `className` attributes (these control styling)
- Don't change the structure of the JSX (the HTML-like tags)
- Only change the text content between the opening and closing tags
- Be careful with quotes - use single quotes `'` for text inside double quotes `"`

---

## Submitting Pull Requests

Once you've made your changes, you'll need to submit a pull request (PR) for review. Here's how:

### Step 1: Create a New Branch

Before making changes, create a new branch with a descriptive name:

```bash
# Make sure you're on the main branch and it's up to date
git checkout main
git pull origin main

# Create a new branch for your changes
git checkout -b update/jordan-jardine-bio
# or
git checkout -b update/homepage-hero-text
```

**Branch naming tips:**
- Use descriptive names: `update/instructor-name-bio`, `fix/homepage-typo`, `add/new-instructor-images`
- Use lowercase and hyphens: `update-homepage-copy` (not `UpdateHomepageCopy`)

### Step 2: Make Your Changes

Edit the files as described in the sections above.

### Step 3: Stage and Commit Your Changes

```bash
# Check what files you've changed
git status

# Stage the files you want to commit
git add apps/marketing/lib/instructors.ts
git add apps/marketing/app/page.tsx
git add apps/marketing/public/instructors/jordan-jardine/profile.jpg
# (add all files you've changed)

# Commit with a descriptive message
git commit -m "Update Jordan Jardine bio and profile image"
```

**Commit message tips:**
- Be specific: "Update homepage hero section text" (not just "Update homepage")
- Use present tense: "Add" not "Added", "Update" not "Updated"

### Step 4: Push Your Branch to GitHub

```bash
# Push your branch to GitHub
git push origin update/jordan-jardine-bio
# (use your actual branch name)
```

### Step 5: Create a Pull Request on GitHub

1. Go to the repository on GitHub: https://github.com/dlitorja/mentorships-infra

2. You should see a banner at the top saying "Your recently pushed branches" with a button to "Compare & pull request"

3. Click "Compare & pull request"

4. Fill out the pull request:
   - **Title**: Brief description of your changes (e.g., "Update Jordan Jardine bio and profile image")
   - **Description**: 
     - What changes did you make?
     - Why did you make them?
     - Any additional context or notes

   **Example PR Description:**
   ```
   ## Changes Made
   - Updated Jordan Jardine's bio with new information about recent projects
   - Replaced profile image with updated headshot
   - Updated homepage hero section subtitle

   ## Why
   - Jordan requested bio update to reflect current work
   - New profile image is higher quality
   - Homepage subtitle needed to be more concise

   ## Testing
   - Reviewed changes locally (if applicable)
   - Verified image file sizes are reasonable
   ```

5. Click "Create pull request"

### Step 6: Wait for Review

- The repository owner will review your pull request
- They may request changes or ask questions
- Once approved, they will merge your changes
- You'll be notified when the PR is merged

### Tips for Successful Pull Requests

✅ **DO:**
- Make focused, single-purpose changes (one PR per type of change)
- Write clear commit messages and PR descriptions
- Test your changes if possible (check for typos, verify image paths)
- Keep PRs small and manageable

❌ **DON'T:**
- Mix unrelated changes in one PR
- Commit changes to files outside `apps/marketing/`
- Push directly to the `main` branch (always use a feature branch)
- Include large binary files without checking file size first

---

## Quick Reference

### File Locations

| What to Change | File Path |
|----------------|-----------|
| Homepage content | `apps/marketing/app/page.tsx` |
| Instructor bios/taglines | `apps/marketing/lib/instructors.ts` |
| Instructor profile images | `apps/marketing/public/instructors/[slug]/profile.jpg` |
| Instructor portfolio images | `apps/marketing/public/instructors/[slug]/work-*.jpg` |

### Common Git Commands

```bash
# Check what branch you're on
git branch

# See what files you've changed
git status

# See the actual changes you made
git diff

# Undo changes to a file (before committing)
git checkout -- apps/marketing/lib/instructors.ts

# Update your branch with latest changes from main
git checkout main
git pull origin main
git checkout your-branch-name
git merge main
```

---

## Getting Help

If you run into issues:

1. **Git/technical issues**: Contact the repository owner
2. **Content questions**: Check with the team lead about what content should be
3. **Image requirements**: Refer to `apps/marketing/public/instructors/README.md` for detailed image guidelines

---

## Summary Checklist

Before submitting a PR, make sure:

- [ ] All changes are in `apps/marketing/` directory only
- [ ] Images are properly sized and named
- [ ] Image paths in `instructors.ts` match actual file names
- [ ] No typos or formatting issues
- [ ] Created a new branch (not working directly on `main`)
- [ ] Committed changes with a clear message
- [ ] Pushed branch to GitHub
- [ ] Created pull request with clear description

---

**Happy editing! 🎨**

