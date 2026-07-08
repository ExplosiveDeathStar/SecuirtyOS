"""Build a test video that emulates a camera: ~8s with people in frame,
then ~8s of empty scene. Lets us verify event open/close end to end."""

import cv2
import numpy as np

img = cv2.imread("person.jpg")
img = cv2.resize(img, (640, 480))
empty = np.full_like(img, 40)  # dim empty room

fps = 10
writer = cv2.VideoWriter("camera.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 480))
for _ in range(fps * 8):
    writer.write(img)
for _ in range(fps * 8):
    writer.write(empty)
writer.release()
print("camera.mp4 written")
