import React from 'react'
import ReactDOM from 'react-dom'
import queryString from 'query-string'
import Cropper from '../../src'
import './styles.css'

const urlArgs = queryString.parse(window.location.search)
const imageSrc = urlArgs.img || '/images/dog.jpeg' // so we can change the image from our tests

class App extends React.Component {
  state = {
    imageSrc,
    crop: { x: 0, y: 0 },
    rotation: 0,
    zoom: 1,
    aspect: 4 / 3,
    cropShape: 'rect',
    showGrid: true,
    zoomSpeed: 1,
    restrictPosition: true,
  }

  onCropChange = crop => {
    this.setState({ crop })
  }

  onCropComplete = (croppedArea, croppedAreaPixels) => {
    console.log(croppedArea, croppedAreaPixels)
  }

  onZoomChange = zoom => {
    this.setState({ zoom })
  }

  onInteractionStart = () => {
    console.log('user interaction started')
  }

  onInteractionEnd = () => {
    console.log('user interaction ended')
  }

  render() {
    return (
      <div className="App">
        <input
          type="range"
          min={0}
          max={360}
          onChange={({ target: { value: rotation } }) => this.setState({ rotation })}
          style={{ position: 'fixed', zIndex: 9999999 }}
        />
        <div className="crop-container">
          <Cropper
            image={this.state.imageSrc}
            crop={this.state.crop}
            rotation={this.state.rotation}
            zoom={this.state.zoom}
            aspect={this.state.aspect}
            cropShape={this.state.cropShape}
            showGrid={this.state.showGrid}
            zoomSpeed={this.state.zoomSpeed}
            restrictPosition={this.state.restrictPosition}
            onCropChange={this.onCropChange}
            onCropComplete={this.onCropComplete}
            onZoomChange={this.onZoomChange}
            onInteractionStart={this.onInteractionStart}
            onInteractionEnd={this.onInteractionEnd}
            initialCroppedAreaPixels={
              urlArgs.setInitialCrop && { width: 699, height: 524, x: 875, y: 157 } // used to set the initial crop in e2e test
            }
          />
        </div>
      </div>
    )
  }
}

const rootElement = document.getElementById('root')
ReactDOM.render(<App />, rootElement)
