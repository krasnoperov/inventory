# Image Generation Guide

Learn how to generate, derive, and refine images using the Forge.

## What the AI Does Best

Our image generation is powered by Gemini, which excels at:

- **Text in images** — Legible text for logos, signs, diagrams, infographics, UI mockups
- **World knowledge** — Architectural styles, historical periods, real places, cultural references
- **Multi-image composition** — Using multiple references while keeping elements consistent
- **Iterative refinement** — Making adjustments through conversation while preserving context
- **Complex scenes** — Understanding relationships between elements ("holding", "in front of", "next to")
- **Professional quality** — High-resolution output with control over lighting and camera angles

## Understanding the Basics

The Forge uses AI to generate images from your text descriptions. You can:
- **Generate** entirely new images from scratch
- **Derive** new images using existing ones as inspiration
- **Refine** existing assets with modifications
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
- **Game characters:** "Elven ranger with silver hair in a long braid, leaf-patterned leather armor, carrying a recurve bow, forest background, fantasy illustration style"
- **Game items:** "Legendary fire sword with obsidian blade, molten cracks glowing orange, wrapped leather grip, dramatic lighting, RPG item art"
- **Architecture:** "Red brick Victorian townhouse with bay windows, black iron railings, climbing ivy on facade, overcast London sky"
- **Interiors:** "Scandinavian living room with light oak flooring, white linen sofa, monstera plant in terracotta pot, soft north-facing window light"
- **People:** "Woman in her 30s with shoulder-length black hair, wearing a navy blazer, confident expression, studio lighting"
- **Products:** "Matte black ceramic coffee mug, cylindrical, 12oz, on white marble surface, soft diffused light"
- **Food:** "Artisan sourdough bread loaf, golden crust with flour dusting, rustic wooden cutting board, warm kitchen lighting"
- **Fashion:** "Oversized camel wool coat, double-breasted with tortoiseshell buttons, draped on minimal white mannequin, editorial style"
- **Logos:** "Vintage coffee shop logo, art deco style, 'MORNING BREW' text in gold serif font, circular badge design with coffee bean motif"
- **Infographics:** "Step-by-step recipe diagram showing 4 stages of bread making, clean icons, minimal flat style, numbered steps with short labels"
- **UI mockups:** "Mobile app login screen, modern minimal design, 'Welcome Back' heading, email and password fields, blue accent buttons"

### Refine an Existing Image
When you have an image but want to change something, use refinement. The AI will modify your existing image based on your instructions.

**Example refinements:**
- **Game:** "Change the armor color to deep crimson red" / "Add a flowing black cape attached at the shoulders"
- **Interior:** "Change the sofa upholstery to navy blue velvet" / "Add a brass pendant light above the dining table"
- **Architecture:** "Add a rooftop garden with greenery visible" / "Change facade material to weathered copper panels"
- **People:** "The person is now seated at the desk, same outfit" / "Change expression to a warm smile"
- **Product:** "Change the mug color to terracotta orange" / "Add steam rising from the cup"
- **Food:** "Add a pat of melting butter on top" / "Sprinkle fresh herbs as garnish"
- **Fashion:** "Change the coat color to charcoal grey" / "Add a silk scarf draped around the collar"
- **Logo:** "Change the text to 'SUNSET CAFE'" / "Add a subtle drop shadow to the badge"
- **UI:** "Change the button color to green" / "Add a 'Forgot Password?' link below the form"

### Derive from Multiple Images
The most powerful feature—take elements from multiple images and create something new.

**Example derivations:**
- **Game:** Place a character into a scene/environment; equip a character with a weapon from another image
- **Interior:** Place furniture from one image into a room from another
- **Architecture:** Use a building facade with landscaping from a different image
- **People:** Put a person from a portrait into an office or lifestyle environment
- **Product:** Place a product into a lifestyle scene (coffee mug on a cozy desk setup)
- **Food:** Use a plated dish with a restaurant table setting background
- **Fashion:** Place a garment on a model from another image; use outfit pieces together

### Fork an Image
Create an exact copy of an image as a new asset. Useful when you want to take an existing design in a completely different direction without losing the original.

---

## Working with the Forge Tray

The Forge Tray at the bottom of your screen is your creative workbench.

### Adding References
Click the **+** button to add images as references. You can add up to 14 reference images.

### Choosing a Destination
- **Current**: Add the result as a new variant to an existing asset (Refine)
- **New**: Create an entirely new asset (Derive)

### The Action Button
The button label changes based on what you're doing:
- **Generate** — Creating from text only (no references)
- **Fork** — Copying an image without AI changes
- **Derive** — Creating new asset using references
- **Refine** — Adding variant to existing asset

---

## Tips for Better Results

### Be Specific in Your Prompts
The AI responds well to detailed descriptions. Include materials, textures, and specific details:
- Instead of "a warrior," try "elven ranger with silver braided hair, leaf-patterned leather armor, glowing amber eyes"
- Instead of "a building," try "red brick Victorian townhouse with bay windows and black iron railings"
- Instead of "a living room," try "Scandinavian living room with light oak flooring, white linen sofa, large monstera"
- Instead of "a person," try "woman in her 30s, shoulder-length black hair, navy blazer, confident expression"
- Instead of "a product shot," try "matte black ceramic mug on white marble surface, soft diffused light"
- Instead of "food," try "artisan sourdough loaf, golden crust with flour dusting, rustic wooden board"
- Instead of "a logo," try "art deco coffee shop badge, 'MORNING BREW' in gold serif font, circular design"
- Instead of "an app screen," try "login screen with 'Welcome Back' heading, email field, blue accent buttons"

### One Step at a Time
Making multiple changes at once can lead to unpredictable results.

**Bad:** "Make the armor red, add a cape, and give them a different weapon"

**Good:**
1. First: "Change armor color to deep crimson red"
2. Then: "Add flowing black cape attached at shoulders"
3. Finally: "Replace sword with battle axe"

**Another example:**

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

**Tip:** For complex scenes, build up gradually. Start with your main subject, then derive with backgrounds and additional elements one at a time.

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
- **For game characters:** Create a "character sheet" with front/back/side views, then use for action poses and scenes
- **For people:** A clear portrait with good lighting, then use for different poses/scenes
- **For interiors:** Generate the base room, then use as reference for different angles or times of day
- **For architecture:** Generate the main exterior view, then use for interior shots or different angles
- **For game items:** Generate the item clearly on neutral background, then derive with characters

### Use Visual Anchors

Repeat the same descriptive phrases exactly across prompts:
- **Game characters:** "silver hair in a long braid", "leaf-patterned leather armor", "glowing amber eyes"
- **Architecture:** "red brick Victorian facade", "industrial steel-frame windows", "wrought iron railings"
- **Interiors:** "light oak with visible grain", "white linen upholstery", "brushed brass hardware"
- **People:** "woman with short silver hair and round glasses", "man in charcoal wool coat"
- **Products:** "matte black ceramic", "white marble surface", "soft diffused studio light"
- **Food:** "rustic wooden board", "fresh herb garnish", "warm kitchen lighting"
- **Logos/Branding:** "gold serif font", "art deco geometric shapes", "circular badge design"
- **UI elements:** "rounded corners", "blue accent color", "minimal flat style"
- **Art style:** "painterly fantasy illustration", "photorealistic", "editorial photography", "flat vector"

Consistency in your language helps the AI maintain consistency in the visuals.

### Make Small Changes

Change only ONE thing at a time:
- Change the furniture color, OR add a new piece, OR change the lighting
- NOT all three at once

Each small step preserves more of what came before.

### Be Explicit About Changes

When adding or removing elements, say it clearly:
- **Game:** "Character now holding a staff in right hand. Staff with crystal orb on top."
- **Game:** "Remove the helmet. Character's face now visible, same hairstyle."
- **Interior:** "Add a pendant light above the dining table. Brass globe pendant centered."
- **Architecture:** "Add climbing ivy on the left side of the facade."
- **People:** "The person is now seated at the desk. Same outfit, seated position."
- **Food:** "Add a drizzle of olive oil on top. Oil pooling slightly."

### Reference Your Images Clearly

When combining multiple references, be specific:
- **Game:** "The warrior from image 1 holding the sword from image 2"
- **Interior:** "The armchair from image 1 placed in the living room from image 2"
- **Product:** "The coffee mug from image 1 on the desk setup from image 2"
- **Fashion:** "The coat from image 1 worn by the model from image 2"

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

> **Game scene:** "The mage character from image 1 standing in the crystal cave from image 2. Character in center, casting pose with hands raised. Keep the cave's blue ambient glow. Maintain character's exact robe design and staff."

> **Interior design:** "The modern armchair from image 1 placed in the living room from image 2. Position armchair in the corner by the windows. Maintain the warm afternoon lighting. Keep the chair's exact fabric texture and walnut legs."

> **Architecture:** "The Victorian townhouse from image 1 with the garden landscaping from image 2 in the foreground. Overcast soft lighting. Maintain the building's red brick and iron railings exactly."

> **Product lifestyle:** "The ceramic mug from image 1 placed on the desk setup from image 2. Position mug near the keyboard. Maintain the cozy morning lighting. Keep the mug's exact matte black finish."

> **Food styling:** "The sourdough loaf from image 1 on the rustic table setting from image 2. Position bread on the wooden board. Maintain warm kitchen lighting. Keep the bread's golden crust texture."

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

**For game development:**
1. Generate your character with detailed appearance and art style
2. Create a character sheet (front/back/side views) using refine
3. Combine character with environments and items

**For architecture:**
1. Generate the main exterior view with materials and lighting
2. Refine for different angles or times of day
3. Derive with landscaping or context images

**For interior design:**
1. Generate your base room with style, materials, and lighting
2. Refine with one furniture change at a time
3. Try different times of day or lighting moods

**For people/portraits:**
1. Generate a clear reference portrait
2. Refine for different expressions or poses
3. Derive with environments for lifestyle shots

**For products:**
1. Generate your hero product shot on neutral background
2. Derive with different lifestyle scene backgrounds
3. Refine lighting or styling as needed

**For food photography:**
1. Generate your hero dish with plating and lighting
2. Refine with garnishes or styling changes
3. Derive with table settings or restaurant backgrounds

**For fashion:**
1. Generate garment on mannequin or flat lay
2. Refine colors, details, or accessories
3. Derive with models or lifestyle contexts

**For logos & branding:**
1. Generate your logo with text, style, and shape (Gemini excels at text!)
2. Refine colors, fonts, or decorative elements
3. Create variations for different use cases

**For infographics & diagrams:**
1. Generate your diagram with structure, icons, and labels
2. Refine individual elements or text
3. Maintain consistent style across a series

**For UI mockups:**
1. Generate screen layouts with labels and buttons
2. Refine individual components or copy
3. Create flow sequences for different screens

The best way to learn is to experiment. Every variant you create teaches you more about what the AI can do.
