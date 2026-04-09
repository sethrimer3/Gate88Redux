____________________________________

Gate 88 by Jonathan Mak (aka queasy)
____________________________________

Webpage: http://www.queasygames.com/gate88
Forums:  http://www.queasygames.com/forums
Email:   jon.mak@utoronto.ca

Any comments or feedback will be appreciated!

Major thanks to Jacques Lafontaine for some excellent testing and quality assurance work.



Required Libraries:
===================
Gate 88 uses the following libraries (which are included under the terms of the LGPL license):
SDL
SDL_mixer
SDL_net

Binaries and source code for the libraries are available from: http://www.libsdl.org/



Change List
===========
-added: colour test mode
-added: resource limit
-added: yard kills to single player stats
-added server command: setmaxres _amount_ (sets the maximum resource amount to _amount_)
-added server command: setres _amount_ (sets the resource amount of all players to _amount_)
-added server command: addres _amount_ (adds _amount_ resources to all players)
-fixed: fps drop (choppiness) when many players connect
-fixed: opening private message menu causes crash
-fixed: globe backgrounds covering game entities
-fixed: refreshing master server many times caused trouble connecting to master server
-fixed: speed bug
-fixed: server crash when switching configs
-fixed: not cloaked when command post is destroyed
-fixed: players' position not reset on round end
-fixed: command post is placed immediately if you are specialing while your command post dies
-fixed: friendly hits was incorrectly counted in the stats
-fixed: if action menu held on round end, it stays open
-fixed: exciter turret animates even when unpowered
-fixed: if many players request ally, responding once responds to them all
-fixed: ally spam
-fixed: aspect ratio not reset on resolution change
-fixed: going from fullscreen to window mode causes window to disappear
-fixed: aspect ratio resetting even when resolution change was cancelled
-fixed: going into ally menu, then hitting F1 to go to chat causes game to go into an unrecoverable state
-fixed: going into private message menu, then hitting F1 to go to chat causes game to go into an unrecoverable state
-fixed: yellow particles not showing up when decloaking
-changed: buildings built not in the stats anymore
-changed: start a multiplayer game with more resources
-changed: increased command post mass
-changed: mass driver turrets to push players less
-changed: command post mass so that it does not get pushed from fighter rushes



Command-line Arguments
======================
    server	starts up as dedicated server.
    colourtest  tests the colours
    nosound     starts the game with no sound
    version     displays version info then exits.
    credits     credits information
    greets      greets to...

-----------------------------------------------------------------------------
Last updated Mar17/05
//eof
