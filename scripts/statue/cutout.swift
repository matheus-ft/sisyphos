// Lifts the subject of a photo off its background, as Photos does on a Mac:
// the statue, without the museum around it, as a PNG with transparency.
//
//   swift scripts/statue/cutout.swift <photo> <out.png>
//
// macOS 14 or later (Vision's foreground mask). The photo is read as given; a
// downloaded one is data, so keep it in a folder of its own.
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: swift cutout.swift <photo> <out.png>\n".data(using: .utf8)!)
  exit(2)
}

let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
guard let image = CIImage(contentsOf: input) else {
  FileHandle.standardError.write("cannot read \(input.path)\n".data(using: .utf8)!)
  exit(1)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: image)
try handler.perform([request])
guard let result = request.results?.first else {
  FileHandle.standardError.write("no subject found\n".data(using: .utf8)!)
  exit(1)
}

// Every subject Vision found, at the photo's own size, masked out of it.
let buffer = try result.generateMaskedImage(
  ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
let lifted = CIImage(cvPixelBuffer: buffer)
let context = CIContext()
try context.writePNGRepresentation(
  of: lifted, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("wrote \(output.path): \(Int(lifted.extent.width)) x \(Int(lifted.extent.height))")
