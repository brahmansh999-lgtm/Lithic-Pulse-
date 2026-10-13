exterior.jpg is a procedurally-generated equirectangular sky/skyline panorama
(see _gen_hdri.mjs at the repo root, or regenerate with different seed/params)
— used as a placeholder-quality but functioning exterior reflection map until
a real photographed skyline HDRI/EXR is available. To replace with a real one,
drop it in here as exterior.hdr, .exr, or .jpg/.png (equirectangular) and
update EXTERIOR_HDRI_URL in RoomConfigurator.jsx and RoomHeroView.jsx to match
the filename.
