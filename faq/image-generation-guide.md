# Image Generation Guide

Learn how to create, refine, and combine images using the Forge.

## Understanding the Basics

The Forge uses AI to generate images from your text descriptions. You can:
- **Generate** entirely new images from scratch
- **Refine** existing images with modifications
- **Combine** multiple images into something new
- **Fork** an image to create a copy as a starting point

## Core Concepts

### Assets
An asset is any visual entity you create—a character, item, scene, or anything else. Think of assets as the building blocks of your creative inventory.

### Variants
Every asset can have multiple versions called variants. When you refine an image, you're creating a new variant of that asset. This lets you explore different directions while keeping the original safe.

### The Active Variant
Each asset has one "active" variant that represents its current look. You can switch between variants at any time.

---

## Creating Images

### Generate from Scratch
Start with just a text prompt. Describe what you want to see, and the AI will create it.

**Example prompts:**
- **Interiors:** "Scandinavian living room with light oak flooring, white linen sofa, monstera plant in terracotta pot, soft north-facing window light"
- **Architecture:** "Mid-century modern house with floor-to-ceiling windows, flat roof, cantilevered second floor, desert landscape, golden hour"
- **People:** "Woman in her 30s with shoulder-length black hair, wearing a navy blazer, confident expression, studio lighting"
- **Products:** "Matte black ceramic coffee mug, cylindrical, 12oz, on white marble surface, soft diffused light"
- **Fantasy:** "A medieval knight in polished silver plate armor with blue trim, standing confidently, painterly fantasy art style"

### Refine an Existing Image
When you have an image but want to change something, use refinement. The AI will modify your existing image based on your instructions.

**Example refinements:**
- "Change the sofa upholstery to navy blue velvet"
- "Add a brass pendant light above the dining table"
- "Change the time of day to sunset with warm orange light"
- "The person is now seated at the desk, same outfit"
- "Replace the curtains with white wooden venetian blinds"

### Combine Multiple Images
The most powerful feature—take elements from multiple images and merge them into something new.

**Example combinations:**
- Place a piece of furniture from one image into a room from another
- Put a person from a portrait into an environment shot
- Combine a building facade with landscaping from a different image
- Create a product lifestyle shot by combining product with a scene

### Fork an Image
Create an exact copy of an image as a new asset. Useful when you want to take an existing design in a completely different direction without losing the original.

---

## Working with the Forge Tray

The Forge Tray at the bottom of your screen is your creative workbench.

### Adding References
Click the **+** button to add images as references. You can add up to 4 reference images for combining.

### Choosing a Destination
- **Current**: Add the result as a new variant to an existing asset
- **New**: Create an entirely new asset

### The Action Button
The button label changes based on what you're doing:
- **Generate** — Creating from text only
- **Refine** — Modifying a single image
- **Combine** — Merging multiple images
- **Fork** — Copying without changes

---

## Tips for Better Results

### Be Specific in Your Prompts
The AI responds well to detailed descriptions. Include materials, textures, and specific details:
- Instead of "a living room," try "Scandinavian living room with light oak flooring, white linen sofa, large monstera in terracotta pot"
- Instead of "a person," try "woman in her 30s, shoulder-length black hair, navy blazer, confident expression"
- Instead of "a building," try "red brick Victorian townhouse with bay windows and black iron railings"

### One Step at a Time
Making multiple changes at once can lead to unpredictable results.

**Bad:** "Change the sofa to blue, add a coffee table, and make it evening lighting"

**Good:**
1. First: "Change sofa upholstery to navy blue velvet"
2. Then: "Add walnut coffee table in front of sofa"
3. Finally: "Change to warm evening lighting from table lamps"

### Describe What You Want, Not What You Don't Want
"Minimalist room with clean surfaces" works better than "remove the clutter." The AI responds better to positive descriptions.

### Use References When Possible
When refining or combining, adding reference images gives the AI more context. The more visual information it has, the better it can understand your intent.

### Iterate and Explore
Don't expect perfection on the first try. Generate several variants, pick the best one, then refine further. Each step gets you closer to your vision.

---

## Understanding Spatial Relationships

The AI has some understanding of space and composition:

### What Works Well
- Placing objects in scenes
- Positioning characters relative to backgrounds
- Basic spatial relationships ("in front of," "next to," "holding")

### What's More Challenging
- Precise positioning ("exactly 3 feet to the left")
- Complex multi-character arrangements
- Maintaining exact proportions across combinations

**Tip:** For complex scenes, build up gradually. Start with your main subject, then combine with backgrounds and additional elements one at a time.

---

## Combining Images Effectively

### Start with Compatible References
Images with similar styles, lighting, and perspectives combine more naturally.

### Describe the Relationship
When combining, tell the AI how the elements should relate:
- "The character standing in this scene, facing right"
- "The sword held in the knight's right hand"
- "These two characters facing each other in conversation"

### Control the Blend
Your prompt determines how much of each reference influences the result. Be specific about what you want from each:
- "Use the pose from the first image but the costume style from the second"
- "Place this character in this environment, keeping the character's exact appearance"

---

## Keeping Elements Consistent

One of the biggest challenges in AI image generation is maintaining visual consistency across multiple images. Here's how to do it well.

### Create Reference Sheets

Start by generating a "reference image" that establishes your visual identity:
- **For people:** A clear portrait with good lighting, then use for different poses/scenes
- **For interiors:** Generate the base room, then use as reference for different angles or times of day
- **For architecture:** Generate the main exterior view, then use for interior shots or different angles
- **For products:** Generate a hero shot, then use for lifestyle/context images

### Use Visual Anchors

Repeat the same descriptive phrases exactly across prompts:
- **Materials:** "light oak with visible grain", "brushed brass hardware", "white linen upholstery"
- **People:** "woman with short silver hair and round glasses", "man in charcoal wool coat"
- **Style:** "soft diffused natural light from large windows", "warm golden hour sunlight"
- **Architecture:** "red brick Victorian facade", "industrial steel-frame windows"

Consistency in your language helps the AI maintain consistency in the visuals.

### Make Small Changes

Change only ONE thing at a time:
- Change the furniture color, OR add a new piece, OR change the lighting
- NOT all three at once

Each small step preserves more of what came before.

### Be Explicit About Changes

When adding or removing elements, say it clearly:
- "Add a pendant light above the dining table. Brass globe pendant centered over table."
- "Remove the rug. Hardwood floor now visible throughout the room."
- "The person is now seated at the desk. Same outfit, seated position."

### Reference Your Images Clearly

When combining multiple references, be specific:
- "The armchair from the first image"
- "The room layout from the second reference"
- "Place the furniture from image 1 in the space from image 2"

---

## Structured Prompts for Complex Scenes

For best results with multiple references, structure your prompts clearly:

**Elements to include:**
- **References:** What each input image represents
- **Scene:** The setting or environment
- **Subject:** What goes where, spatial relationships
- **Lighting:** Direction, quality, time of day
- **Constraints:** What must stay the same

**Examples:**

> **Furniture in room:** "The modern armchair from image 1 placed in the living room from image 2. Position armchair in the corner by the windows. Maintain the warm afternoon lighting from image 2. Keep the chair's exact fabric texture and walnut legs."

> **Person in environment:** "The woman from image 1 standing in the office space from image 2, near the window. Same outfit and pose. Keep the office's natural lighting and color palette."

> **Architecture composite:** "The building facade from image 1 with the landscaping from image 2 in the foreground. Golden hour lighting. Maintain the building's exact proportions and materials."

---

## Building Lineage

Every image remembers where it came from. This "lineage" helps you:
- Trace how a design evolved
- Recreate successful combinations
- Understand what prompts led to results you like

You can view an asset's full history to see all the images and prompts that contributed to its creation.

---

## Quick Reference

| What You Want | How to Do It |
|---------------|--------------|
| Create from imagination | Type a prompt with no references |
| Modify an image | Add one reference, type changes |
| Merge multiple images | Add 2-4 references, describe combination |
| Copy and diverge | Add one reference, leave prompt empty |

---

## Getting Started

**For interior design:**
1. Generate your base room with style, materials, and lighting
2. Refine with one furniture change at a time
3. Try different times of day or lighting moods

**For architecture:**
1. Generate the main exterior view
2. Create interior views using exterior as reference
3. Combine with different landscaping or contexts

**For people/portraits:**
1. Generate a clear reference portrait
2. Refine for different expressions or poses
3. Combine with environments for lifestyle shots

**For products:**
1. Generate your hero product shot
2. Combine with different scene backgrounds
3. Refine lighting or angles as needed

The best way to learn is to experiment. Every variant you create teaches you more about what the AI can do.
