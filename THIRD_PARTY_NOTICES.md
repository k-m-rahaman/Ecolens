# Bundled dependencies

Firebase JavaScript SDK 13.0.0 (App, AI Logic and App Check) is bundled from Google's official versioned CDN under Apache License 2.0. Its Firebase App import points to the bundled local file. [Source and license](https://github.com/firebase/firebase-js-sdk). The full license is in `vendor/LICENSE-firebase.txt`.

The application bundles these dependencies to support local inference and offline operation. Their upstream licenses apply to their respective files.

- ONNX Runtime Web 1.20.1 — Microsoft, MIT license. [Source and license](https://github.com/microsoft/onnxruntime/blob/v1.20.1/LICENSE).
- TensorFlow.js 4.22.0 — TensorFlow authors, Apache License 2.0. [Source and license](https://github.com/tensorflow/tfjs/blob/tfjs-v4.22.0/LICENSE).
- TensorFlow.js COCO-SSD 2.2.3 and the public SSD Lite MobileNet v2 helper weights — TensorFlow authors, Apache License 2.0 project. [Source](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), [project license](https://github.com/tensorflow/tfjs-models/blob/master/LICENSE). Weights are served from the project's public TensorFlow model storage.

The custom waste model and branding assets came from the user's original EcoLens repository. This upgrade does not assign a new license to those assets or the user's project. The working model export is FP32 for runtime compatibility; its training/classes were not changed.
