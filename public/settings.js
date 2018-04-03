import uiModules from "ui/modules";
import chrome from 'ui/chrome';

const app = uiModules.get('app/logtrail', []);

app.controller('SettingsController', function($scope, $http) {

  $scope.settings = {
    messageFormat: "{{{ message }}}",
    timeRange: 10
  };

  $scope.$on("show-settings", function(event, data) {
    showSettings(data);
  });

  $scope.hideSettings = function() {
    angular.element("#settings").addClass("ng-hide");
  };

  $scope.saveSettings = function () {
    $http.post(chrome.addBasePath('/logtrail/settings'),$scope.settings).then(function (resp) {
      if (resp.data.ok) {
        angular.element("#settings").addClass("ng-hide");
        $scope.$emit("settings-saved");
      } else {
        console.error("Cannot update settings " + JSON.stringify(resp));
        $scope.$parent.errorMessage = "Cannot update settings!";
      }
    });
  }

  function showSettings(args) {
    var selected_index_config = args.selected_index_config;
    $scope.settings.settingsNotFound = args.settingsNotFound;
    $http.get(chrome.addBasePath('/logtrail/settings')).then(function (resp) {
      if (resp.data.ok) {
         var hostFields = [];
         var programFields = [];
         for (let field of resp.data.fields) {
           programFields.push(field.name);
           if (field.type === 'keyword') {
            hostFields.push(field.name);
           }
           if (field.rawType && field.rawType === 'keyword') {
            hostFields.push(field.name + '.raw');
           }
         }
         $scope.settings['hostFields'] = hostFields;
         $scope.settings['programFields'] = programFields;
         if (selected_index_config) {
          $scope.settings.host = selected_index_config.fields.mapping.hostname;
          if (selected_index_config.fields.hostname_keyword) {
            $scope.settings.host = selected_index_config.fields.hostname_keyword;
          }
          $scope.settings.program = selected_index_config.fields.mapping.program;
          $scope.settings.messageFormat = selected_index_config.fields.message_format;
          $scope.settings.timeRange = selected_index_config.default_time_range_in_days;
         }
         angular.element('#settings').removeClass("ng-hide");
      } else {
        $scope.$parent.errorMessage = "Cannot fetch settings!"
        console.error("Error while fetching settings" + JSON.stringify(resp));
      }
    });
  }
});
