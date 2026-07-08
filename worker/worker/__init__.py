"""SecurityOS detection worker.

A local Python process that:
  * pulls the camera registry from the backend,
  * reads each RTSP stream with OpenCV,
  * runs YOLO person detection on every camera,
  * turns raw detections into timeline events (with snapshots and clips),
  * serves MJPEG live previews to the backend.

No frames or credentials ever leave this machine.
"""
