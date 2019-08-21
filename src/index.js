import React from 'react'
import {
  getCropSize,
  restrictPosition,
  getDistanceBetweenPoints,
  computeCroppedArea,
  getCenter,
  getInitialCropFromCroppedAreaPixels,
} from './helpers'
import { Container, Img, CropArea } from './styles'

function rotate(x, y, xm, ym, a) {
  var cos = Math.cos,
    sin = Math.sin,
    a = (a * Math.PI) / 180, // Convert to radians
    // Subtract midpoints, so that midpoint is translated to origin
    // and add it in the end again
    xr = (x - xm) * cos(a) - (y - ym) * sin(a) + xm,
    yr = (x - xm) * sin(a) + (y - ym) * cos(a) + ym

  return [xr, yr]
}

function translateSize(width, height, rotation) {
  const centerX = width / 2
  const centerY = height / 2

  const outerBounds = [
    rotate(0, 0, centerX, centerY, rotation),
    rotate(width, 0, centerX, centerY, rotation),
    rotate(width, height, centerX, centerY, rotation),
    rotate(0, height, centerX, centerY, rotation),
  ]

  const { minX, maxX, minY, maxY } = outerBounds.reduce(
    (res, [x, y]) => ({
      minX: typeof res.minX === 'number' ? Math.min(x, res.minX) : x,
      maxX: typeof res.maxX === 'number' ? Math.max(x, res.maxX) : x,
      minY: typeof res.minY === 'number' ? Math.min(y, res.minY) : y,
      maxY: typeof res.maxY === 'number' ? Math.max(y, res.maxY) : y,
    }),
    {}
  )

  return { width: maxX - minX, height: maxY - minY }
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3

class Cropper extends React.Component {
  image = null
  container = null
  containerRect = {}
  imageSize = { width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 }
  dragStartPosition = { x: 0, y: 0 }
  dragStartCrop = { x: 0, y: 0 }
  lastPinchDistance = 0
  rafDragTimeout = null
  rafZoomTimeout = null
  state = {
    cropSize: null,
    hasWheelJustStarted: false,
  }

  componentDidMount() {
    window.addEventListener('resize', this.computeSizes)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    this.container.addEventListener('gesturestart', this.preventZoomSafari)
    this.container.addEventListener('gesturechange', this.preventZoomSafari)

    // when rendered via SSR, the image can already be loaded and its onLoad callback will never be called
    if (this.image && this.image.complete) {
      this.onImgLoad()
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.computeSizes)
    this.container.removeEventListener('wheel', this.onWheel)
    this.container.removeEventListener('gesturestart', this.preventZoomSafari)
    this.container.removeEventListener('gesturechange', this.preventZoomSafari)
    this.cleanEvents()
    clearTimeout(this.wheelTimer)
  }

  componentDidUpdate(prevProps) {
    if (prevProps.aspect !== this.props.aspect || prevProps.rotation !== this.props.rotation) {
      this.computeSizes()
    } else if (prevProps.zoom !== this.props.zoom) {
      this.recomputeCropPosition()
    }
  }

  // this is to prevent Safari on iOS >= 10 to zoom the page
  preventZoomSafari = e => e.preventDefault()

  cleanEvents = () => {
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mouseup', this.onDragStopped)
    document.removeEventListener('touchmove', this.onTouchMove)
    document.removeEventListener('touchend', this.onDragStopped)
  }

  onImgLoad = () => {
    this.computeSizes()
    this.emitCropData()
    this.setInitialCrop()
  }

  setInitialCrop = () => {
    const { initialCroppedAreaPixels } = this.props

    if (!initialCroppedAreaPixels) {
      return
    }

    const { crop, zoom } = getInitialCropFromCroppedAreaPixels(
      initialCroppedAreaPixels,
      this.imageSize
    )
    this.props.onCropChange(crop)
    this.props.onZoomChange && this.props.onZoomChange(zoom)
  }

  getAspect() {
    const { cropSize, aspect } = this.props
    if (cropSize) {
      return cropSize.width / cropSize.height
    }
    return aspect
  }

  computeSizes = () => {
    const { rotation } = this.props

    if (this.image) {
      const { width, height } = translateSize(this.image.width, this.image.height, rotation)
      const { width: naturalWidth, height: naturalHeight } = translateSize(
        this.image.naturalWidth,
        this.image.naturalHeight,
        rotation
      )

      this.imageSize = {
        width,
        height,
        naturalWidth,
        naturalHeight,
      }
      const cropSize = this.props.cropSize
        ? this.props.cropSize
        : getCropSize(width, height, this.props.aspect)
      this.setState({ cropSize }, this.recomputeCropPosition)
    }
    if (this.container) {
      this.containerRect = this.container.getBoundingClientRect()
    }
  }

  static getMousePoint = e => ({ x: Number(e.clientX), y: Number(e.clientY) })

  static getTouchPoint = touch => ({
    x: Number(touch.clientX),
    y: Number(touch.clientY),
  })

  onMouseDown = e => {
    e.preventDefault()
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mouseup', this.onDragStopped)
    this.onDragStart(Cropper.getMousePoint(e))
  }

  onMouseMove = e => this.onDrag(Cropper.getMousePoint(e))

  onTouchStart = e => {
    e.preventDefault()
    document.addEventListener('touchmove', this.onTouchMove, { passive: false }) // iOS 11 now defaults to passive: true
    document.addEventListener('touchend', this.onDragStopped)
    if (e.touches.length === 2) {
      this.onPinchStart(e)
    } else if (e.touches.length === 1) {
      this.onDragStart(Cropper.getTouchPoint(e.touches[0]))
    }
  }

  onTouchMove = e => {
    // Prevent whole page from scrolling on iOS.
    e.preventDefault()
    if (e.touches.length === 2) {
      this.onPinchMove(e)
    } else if (e.touches.length === 1) {
      this.onDrag(Cropper.getTouchPoint(e.touches[0]))
    }
  }

  onDragStart = ({ x, y }) => {
    this.dragStartPosition = { x, y }
    this.dragStartCrop = { x: this.props.crop.x, y: this.props.crop.y }
    this.props.onInteractionStart()
  }

  onDrag = ({ x, y }) => {
    if (!this.state.cropSize) return

    if (this.rafDragTimeout) window.cancelAnimationFrame(this.rafDragTimeout)

    this.rafDragTimeout = window.requestAnimationFrame(() => {
      if (x === undefined || y === undefined) return
      const offsetX = x - this.dragStartPosition.x
      const offsetY = y - this.dragStartPosition.y
      const requestedPosition = {
        x: this.dragStartCrop.x + offsetX,
        y: this.dragStartCrop.y + offsetY,
      }

      const newPosition = this.props.restrictPosition
        ? restrictPosition(requestedPosition, this.imageSize, this.state.cropSize, this.props.zoom)
        : requestedPosition
      this.props.onCropChange(newPosition)
    })
  }

  onDragStopped = () => {
    this.cleanEvents()
    this.emitCropData()
    this.props.onInteractionEnd()
  }

  onPinchStart(e) {
    const pointA = Cropper.getTouchPoint(e.touches[0])
    const pointB = Cropper.getTouchPoint(e.touches[1])
    this.lastPinchDistance = getDistanceBetweenPoints(pointA, pointB)
    this.onDragStart(getCenter(pointA, pointB))
  }

  onPinchMove(e) {
    const pointA = Cropper.getTouchPoint(e.touches[0])
    const pointB = Cropper.getTouchPoint(e.touches[1])
    const center = getCenter(pointA, pointB)
    this.onDrag(center)

    if (this.rafZoomTimeout) window.cancelAnimationFrame(this.rafZoomTimeout)
    this.rafZoomTimeout = window.requestAnimationFrame(() => {
      const distance = getDistanceBetweenPoints(pointA, pointB)
      const newZoom = this.props.zoom * (distance / this.lastPinchDistance)
      this.setNewZoom(newZoom, center)
      this.lastPinchDistance = distance
    })
  }

  onWheel = e => {
    e.preventDefault()
    const point = Cropper.getMousePoint(e)
    const newZoom = this.props.zoom - (e.deltaY * this.props.zoomSpeed) / 200
    this.setNewZoom(newZoom, point)

    if (!this.state.hasWheelJustStarted) {
      this.setState({ hasWheelJustStarted: true }, () => this.props.onInteractionStart())
    }

    clearTimeout(this.wheelTimer)
    this.wheelTimer = setTimeout(
      () => this.setState({ hasWheelJustStarted: false }, () => this.props.onInteractionEnd()),
      250
    )
  }

  getPointOnContainer = ({ x, y }, zoom) => {
    if (!this.containerRect) {
      throw new Error('The Cropper is not mounted')
    }
    return {
      x: this.containerRect.width / 2 - (x - this.containerRect.left),
      y: this.containerRect.height / 2 - (y - this.containerRect.top),
    }
  }

  getPointOnImage = ({ x, y }) => {
    const { crop, zoom } = this.props
    return {
      x: (x + crop.x) / zoom,
      y: (y + crop.y) / zoom,
    }
  }

  setNewZoom = (zoom, point) => {
    if (!this.state.cropSize) return

    const zoomPoint = this.getPointOnContainer(point)
    const zoomTarget = this.getPointOnImage(zoomPoint)
    const newZoom = Math.min(this.props.maxZoom, Math.max(zoom, this.props.minZoom))
    const requestedPosition = {
      x: zoomTarget.x * newZoom - zoomPoint.x,
      y: zoomTarget.y * newZoom - zoomPoint.y,
    }
    const newPosition = this.props.restrictPosition
      ? restrictPosition(requestedPosition, this.imageSize, this.state.cropSize, newZoom)
      : requestedPosition

    this.props.onCropChange(newPosition)

    this.props.onZoomChange && this.props.onZoomChange(newZoom)
  }

  emitCropData = () => {
    if (!this.state.cropSize) return
    // this is to ensure the crop is correctly restricted after a zoom back (https://github.com/ricardo-ch/react-easy-crop/issues/6)
    const restrictedPosition = this.props.restrictPosition
      ? restrictPosition(this.props.crop, this.imageSize, this.state.cropSize, this.props.zoom)
      : this.props.crop
    const { croppedAreaPercentages, croppedAreaPixels } = computeCroppedArea(
      restrictedPosition,
      this.imageSize,
      this.state.cropSize,
      this.getAspect(),
      this.props.zoom,
      this.props.restrictPosition
    )
    this.props.onCropComplete &&
      this.props.onCropComplete(croppedAreaPercentages, croppedAreaPixels)
  }

  recomputeCropPosition = () => {
    const newPosition = this.props.restrictPosition
      ? restrictPosition(this.props.crop, this.imageSize, this.state.cropSize, this.props.zoom)
      : this.props.crop
    this.props.onCropChange(newPosition)
    this.emitCropData()
  }

  render() {
    const {
      crop: { x, y },
      rotation,
      zoom,
      cropShape,
      showGrid,
      style: { containerStyle, cropAreaStyle, imageStyle },
      classes: { containerClassName, cropAreaClassName, imageClassName },
      crossOrigin,
    } = this.props

    return (
      <Container
        onMouseDown={this.onMouseDown}
        onTouchStart={this.onTouchStart}
        ref={el => (this.container = el)}
        data-testid="container"
        containerStyle={containerStyle}
        className={containerClassName}
      >
        <Img
          src={this.props.image}
          ref={el => (this.image = el)}
          onLoad={this.onImgLoad}
          onError={this.props.onImgError}
          alt=""
          style={{
            transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${zoom})`,
          }}
          imageStyle={imageStyle}
          className={imageClassName}
          crossOrigin={crossOrigin}
        />
        {this.state.cropSize && (
          <CropArea
            cropShape={cropShape}
            showGrid={showGrid}
            style={{
              width: this.state.cropSize.width,
              height: this.state.cropSize.height,
            }}
            data-testid="cropper"
            cropAreaStyle={cropAreaStyle}
            className={cropAreaClassName}
          />
        )}
      </Container>
    )
  }
}

Cropper.defaultProps = {
  zoom: 1,
  rotation: 0,
  aspect: 4 / 3,
  maxZoom: MAX_ZOOM,
  minZoom: MIN_ZOOM,
  cropShape: 'rect',
  showGrid: true,
  style: {},
  classes: {},
  zoomSpeed: 1,
  crossOrigin: undefined,
  restrictPosition: true,
  onInteractionStart: () => {},
  onInteractionEnd: () => {},
}

export default Cropper
