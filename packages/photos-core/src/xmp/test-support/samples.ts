/** Hand-written sidecars in the shapes Lightroom Classic and darktable write. */

export const LIGHTROOM_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="4"
   xmp:Label="Green"
   xmp:CreatorTool="Adobe Photoshop Lightroom Classic 13.0 (Macintosh)"
   tiff:Orientation="6"
   crs:Version="16.0"
   crs:ProcessVersion="11.0"
   crs:WhiteBalance="Custom"
   crs:Temperature="5600"
   crs:Tint="+8"
   crs:Exposure2012="+0.65"
   crs:Contrast2012="+12"
   crs:Highlights2012="-48"
   crs:Shadows2012="+35"
   crs:Whites2012="+5"
   crs:Blacks2012="-10"
   crs:Vibrance="+15"
   crs:Saturation="-5"
   crs:HasCrop="False"
   crs:HasSettings="True">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Harbour at dusk</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="en-GB">British caption</rdf:li>
     <rdf:li xml:lang="x-default">Boats &amp; lights, Boulogne</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
     <rdf:li>harbour</rdf:li>
     <rdf:li>France</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag>
     <rdf:li>Places|Europe|France</rdf:li>
     <rdf:li>Subjects|Boats</rdf:li>
    </rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;

/** Rejected, with a plain crop, prefixes that differ from the usual ones. */
export const REJECTED_CROPPED_XMP = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:a="http://ns.adobe.com/xap/1.0/" xmlns:cr="http://ns.adobe.com/camera-raw-settings/1.0/">
   <a:Rating>-1</a:Rating>
   <a:Label>Second pick</a:Label>
   <cr:HasCrop>True</cr:HasCrop>
   <cr:CropTop>0.1</cr:CropTop>
   <cr:CropLeft>0.2</cr:CropLeft>
   <cr:CropBottom>0.9</cr:CropBottom>
   <cr:CropRight>0.7</cr:CropRight>
   <cr:CropAngle>0</cr:CropAngle>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
