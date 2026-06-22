#!/bin/bash

# Stop script if any command fails
set -e

# Config
IMAGE_NAME="nest-api"
DOCKERHUB_USERNAME="gelgitshortchase"
REPO_NAME="nest-app"
TAG="latest"

# Build image
docker build -t $IMAGE_NAME .

# Get image ID
IMAGE_ID=$(docker images -q $IMAGE_NAME | head -n 1)

echo "Image ID: $IMAGE_ID"

# Tag image
docker tag $IMAGE_ID $DOCKERHUB_USERNAME/$REPO_NAME:$TAG

# Push image
docker push $DOCKERHUB_USERNAME/$REPO_NAME:$TAG

echo "Docker image pushed successfully!"