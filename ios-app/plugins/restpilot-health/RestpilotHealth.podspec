require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'RestpilotHealth'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary', :text => 'RestPilot' }
  s.homepage = 'https://restpilotai.com'
  s.author = package['author']
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '13.0'
  s.frameworks = 'HealthKit'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
