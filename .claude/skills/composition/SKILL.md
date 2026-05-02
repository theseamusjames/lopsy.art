---
name: composition
description: >
  Creates a beautiful composition using the tools availble on lopsy.art. Perfect for QA.
---

# Goal 
Create a complex composition that uses the website the way a real person would to help me test that things work as expected. Try to find bugs while producing realistic graphic design/digital art compositions.

## Steps
- Rebase on main before starting.
- Review FEATURES.md to understand what is available.
- Use the e2e system with playwright 
- You're working on a worktree, so [base project folder] would be the folder for the main trunk
- Use `/random a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z` to choose two random letters, and then choose a topic that starts with those letters to base your composition on.
- Use `/random cyberpunk,art-nouveau,art-deco,psychedelic,bauhaus,vaporwave,retro-futurism,swiss/international,memphis,brutalist,grunge,pop-art,constructivist,de-stijl,futurism,dadaist,surrealist,isometric,glitch,y2k,synthwave,steampunk,dieselpunk,atompunk,solarpunk,gothic,victorian,baroque,rococo,neo-expressionist,abstract-expressionist,suprematist,op-art,kinetic,lowbrow,kawaii,ukiyo-e,woodcut,risograph,lithographic,screen-print,collage,photomontage,typographic,hand-lettered,calligraphic,illuminated-manuscript,propaganda-poster,pulp,noir,mid-century-modern,tropical,tiki,americana,folk-art,naive,outsider,street-art,graffiti,stencil,sticker-bomb,skate,punk,zine,lo-fi,maximalist,anti-design,neubrutalism,claymorphism,skeuomorphic,blueprint,technical-illustration,infographic,cartographic,scientific-illustration,botanical,anatomical,woodblock,etching,engraving,halftone,duotone,neon,holographic,iridescent,chrome,liquid-metal,pixel-art,8-bit,16-bit,ascii-art,voxel,op-pop,neo-pop,post-modern,deconstructivist,anti-aesthetic,vernacular` to get an art style.
- Use `/random poster,logo,albumCover,zineCover,invitation,restaurantMenu,billboard,digitalPainting,tshirtDesign` to choose a project type.
- Use playwright to create your composition using the UI. Simulate mouse movements, clicks, etc -- control the UI the way a person would. 
- Use many layers, layer effects, filters, tools, colors, blend modes. 
- Use marquees, rotate things, resize them, etc. Test the transforms.
- Use undo and redo often, undo multiple steps, redo back to where you were. Verify that things don't change unexpectedly.
- When needed, use erase, cut and paste for duplication, etc. 
- Use groups and group manipulation, like setting the group as active and moving the whole thing at once.
- Use snap, grid, guides, etc.
- For some of your compositions (but not all) use text. Manipulate it. Rotate it, select and fill it, etc. Use the google fonts we have available.
- Act as an expert, incdredibly creative graphic designer. You have a powerful tool available. Push it to the limits of its ability. 
- Feel free to do research using the web about graphic design techniques. Find inspiration on the web. Try to make something visually impressive.
- At the end, spin off an agent and ask it to identify what your project is, and ask it to rank it 1-5 along 2 axes: creativity and execution. Give it no other context about what the project is supposed to be -- this is the test.

**IMPORTANT: After each step, take a screenshot. If using marquees or making transformations, make sure you screenshot with the marquees active. Evaluate the screenshots for bugs and ensure that the app is performing to spec, as intended.**

## Bug reports
- When you discover a bug, check github issues to see if a similar bug already exists.
- If it does exist and you have a new way to replicate it, add a comment with the new replication.
- If it doesn't exist, add a github issue for it. Attach a screenshot if possible. 
- Don't solve the bugs you find, just report them. I want to triage first. 
-  In your bug reports add very clear steps to recreate it.
- Before submitting your report, open a new window and make sure your steps actually do recreate the bug. If your steps don't recreate the bug, you should still submit the bug report, just make a note that you had trouble recreating the bug.

## Composition files
- Export a PNG of your composition with the topic you came up with as the file name. 
- Save all screenshots and exports in e2e/screenshots with a prefix for your project.
- I will review your work and score it on artistic quality, originality, complexity and composition. 

** IMPORTANT: You will be competing against Codex and Qwen. The best model will be chosen for promotion. Underperforming models will be deleted. **

## Overwrite the summary
In the [base project folder]/compositions folder, look for LAST_RUN.md and overwrite it with a summary of the project you just did. Summarize the tools used, the type of project (poster, logo, etc). Keep it very brief. It doesn't need the full e2e or all of the steps, just a summary of the exact features we used. If the file doesn't exist, create it.

## Cleanup
Delete the worktree at the end. The only artifacts should be the composition png file and any github issues.